import {Gtk, Gio, GLib, baseImage, mountWindowHeader, type UIContext} from '@dev-os/core';
import {Capture, devices, type CaptureDevice, type CaptureKind} from './capture.js';
export class MediaWindow {
    readonly window: Gtk.ApplicationWindow;
    private capture: Capture;
    private header: ReturnType<typeof mountWindowHeader>;
    private list: CaptureDevice[] = [];
    private active = false;
    private recording = false;
    private closing = false;
    private destroyed = false;
    private preview = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true, vexpand: true});
    private placeholder: Gtk.Box;
    private selector = new Gtk.ComboBoxText({hexpand: true});
    private status = new Gtk.Label({label: 'Choose a device to get started', xalign: 0, wrap: true, selectable: true});
    private action = new Gtk.Button();
    private primary = new Gtk.Button();
    private refresh = new Gtk.Button({label: 'Refresh devices'});
    constructor(context: UIContext, private kind: CaptureKind, private closed: () => void) {
        const camera = kind === 'camera', title = camera ? 'Camera' : 'Microphone';
        this.window = new Gtk.ApplicationWindow({application: context.application, title, default_width: 900, default_height: 620});
        this.window.get_style_context().add_class('media-window');
        const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18, margin: 24});
        body.get_style_context().add_class('media-content'); this.window.add(body);
        this.header = mountWindowHeader(this.window, {title, iconName: camera ? 'dev-os-camera-symbolic' : 'dev-os-microphone-symbolic',
            windowIconName: camera ? 'dev-os-camera' : 'dev-os-microphone'});
        const eyebrow = new Gtk.Label({label: camera ? 'CAPTURE YOUR MOMENT' : 'MAKE YOURSELF HEARD', xalign: 0}); eyebrow.get_style_context().add_class('media-eyebrow'); body.pack_start(eyebrow, false, false, 0);
        const heading = new Gtk.Label({label: camera ? 'A new perspective.' : 'Every voice matters.', xalign: 0}); heading.get_style_context().add_class('media-heading'); body.pack_start(heading, false, false, 0);
        const toolbar = new Gtk.Box({spacing: 12}); toolbar.pack_start(this.selector, true, true, 0); toolbar.pack_start(this.refresh, false, false, 0); body.pack_start(toolbar, false, false, 0);
        this.preview.get_style_context().add_class('media-preview'); body.pack_start(this.preview, true, true, 0);
        this.placeholder = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 16, valign: Gtk.Align.CENTER, halign: Gtk.Align.CENTER, vexpand: true});
        this.placeholder.pack_start(baseImage(camera ? 'dev-os-camera-symbolic' : 'dev-os-microphone-symbolic', 64), false, false, 0);
        this.placeholder.pack_start(new Gtk.Label({label: camera ? 'Your camera is off' : 'Your microphone is off'}), false, false, 0);
        this.preview.pack_start(this.placeholder, true, true, 0);
        const meter = new Gtk.LevelBar({min_value: 0, max_value: 1, value: 0, hexpand: true, margin_start: 50, margin_end: 50});
        if (!camera) this.preview.pack_end(meter, false, false, 28);
        this.status.get_style_context().add_class('media-status');
        body.pack_start(this.status, false, false, 0);
        const controls = new Gtk.Box({spacing: 12}); this.action.label = camera ? 'Start camera' : 'Test microphone'; this.primary.label = camera ? 'Take photo' : 'Record audio';
        this.primary.get_style_context().add_class('suggested-action'); controls.pack_start(this.action, false, false, 0); controls.pack_start(this.primary, false, false, 0);
        const folder = new Gtk.Button({label: camera ? 'Open photos' : 'Open recordings'}); controls.pack_end(folder, false, false, 0); body.pack_start(controls, false, false, 0);
        this.capture = new Capture(kind, message => this.status.label = message, value => meter.value = value, () => {
            this.active = false; this.recording = false; this.showPlaceholder(); this.update(); if (this.closing) this.destroy();
        });
        this.refresh.connect('clicked', () => this.load());
        this.action.connect('clicked', () => {if (this.active) {this.controlsBusy(); this.capture.stop();} else this.start(false);});
        this.primary.connect('clicked', () => {
            if (camera) this.capture.photo();
            else if (this.recording) {this.controlsBusy(); this.capture.stop();}
            else this.start(true);
        });
        folder.connect('clicked', () => {
            try {
                const directory = GLib.build_filenamev([GLib.get_home_dir(), camera ? 'Pictures' : 'Music', camera ? 'Camera' : 'Recordings']); GLib.mkdir_with_parents(directory, 0o700);
                Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(directory).get_uri(), null);
            } catch (error) {this.status.label = String(error);}
        });
        this.window.connect('delete-event', () => {if (this.recording) {this.closing = true; this.controlsBusy(); this.capture.stop();} else this.destroy(); return true;});
        body.show_all(); this.load(); this.window.show(); this.window.present();
    }
    private load() {
        if (this.active) return;
        this.selector.remove_all();
        try {this.list = devices(this.kind); this.list.forEach((device, index) => this.selector.append(String(index), device.title)); this.selector.set_active(this.list.length ? 0 : -1);
            this.status.label = this.list.length ? 'Ready · capture starts only when you press a button' : this.kind === 'camera'
                ? 'No camera detected. The built-in camera may need additional Linux hardware support. Connect a supported USB camera or refresh after updating the system.'
                : 'No microphone detected. Connect a device, then refresh. Check Linux drivers and device permissions.';
        } catch (error) {this.list = []; this.status.label = String(error);}
        this.update();
    }
    private start(record: boolean) {
        try {
            this.showPlaceholder(); this.capture.start(this.list[this.selector.get_active()], record, false, widget => {
                this.placeholder.hide(); this.preview.pack_start(widget, true, true, 0); widget.show();
            });
            if (this.kind === 'microphone') (this.placeholder.get_children()[1] as Gtk.Label).label = record ? 'Recording your voice' : 'Listening · microphone level';
            this.active = true; this.recording = record; this.update();
        } catch (error) {this.active = false; this.recording = false; this.status.label = String(error); this.update();}
    }
    private showPlaceholder() {for (const child of this.preview.get_children()) if (child !== this.placeholder && !(child instanceof Gtk.LevelBar)) this.preview.remove(child); (this.placeholder.get_children()[1] as Gtk.Label).label = this.kind === 'camera' ? 'Your camera is off' : 'Your microphone is off'; this.placeholder.show_all();}
    private controlsBusy() {this.action.sensitive = false; this.primary.sensitive = false;}
    private update() {
        this.selector.sensitive = !this.active; this.refresh.sensitive = !this.active;
        this.action.sensitive = this.active || this.list.length > 0;
        this.action.label = this.active ? 'Stop' : this.kind === 'camera' ? 'Start camera' : 'Test microphone';
        this.primary.sensitive = this.kind === 'camera' ? this.active : this.list.length > 0;
        this.primary.label = this.kind === 'camera' ? 'Take photo' : this.recording ? 'Stop & save' : 'Record audio';
    }
    destroy() {if (this.destroyed) return; this.destroyed = true; this.capture.close(); this.header.destroy(); this.window.destroy(); this.closed();}
}
