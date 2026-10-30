import {Gtk, Pango, mountWindowHeader} from '@dev-os/core';
import {WebKit2 as WebKit} from '@dev-os/core/webkit';

/** Keep WebKit's debugger intact, with a themed native host for both layouts. */
export class BrowserInspector {
    private inspector: InstanceType<typeof WebKit.WebInspector>;
    private content?: Gtk.Box;
    private detached?: Gtk.ApplicationWindow;
    private header?: ReturnType<typeof mountWindowHeader>;
    private location?: Gtk.Label;
    private mode?: Gtk.Button;
    private signals: number[];
    constructor(private view: InstanceType<typeof WebKit.WebView>, private parent: Gtk.ApplicationWindow) {
        this.inspector = view.get_inspector();
        this.signals = [
            // Let WebKit manage the embedded view and its size bookkeeping.
            this.inspector.connect('attach', () => {this.release(); return false;}),
            this.inspector.connect('detach', () => {this.release(); return false;}),
            this.inspector.connect('open-window', () => {this.openWindow(); return true;}),
            this.inspector.connect('bring-to-front', () => {if (!this.detached) return false; this.detached.present(); return true;}),
            this.inspector.connect('closed', () => this.clear()),
            this.inspector.connect('notify::inspected-uri', () => this.updateLocation()),
        ];
    }
    private build() {
        if (this.content) return this.content;
        const content = this.content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true, vexpand: true});
        content.get_style_context().add_class('browser-inspector'); content.name = 'browser-inspector';
        const toolbar = new Gtk.Box({spacing: 10}); toolbar.get_style_context().add_class('inspector-toolbar');
        const title = new Gtk.Label({label: 'DEVELOPER TOOLS'}); title.get_style_context().add_class('inspector-title'); toolbar.add(title);
        this.location = new Gtk.Label({xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.MIDDLE, max_width_chars: 56});
        this.location.get_style_context().add_class('inspector-location'); toolbar.pack_start(this.location, true, true, 0);
        const reload = new Gtk.Button({label: 'Reload page', tooltip_text: 'Reload the inspected page'});
        reload.connect('clicked', () => this.view.reload()); toolbar.add(reload);
        this.mode = new Gtk.Button({label: 'Dock below'}); this.mode.connect('clicked', () => this.inspector.attach()); toolbar.add(this.mode);
        const close = new Gtk.Button({label: '×', tooltip_text: 'Close developer tools'});
        close.get_style_context().add_class('inspector-close'); close.connect('clicked', () => this.inspector.close()); toolbar.add(close);
        content.add(toolbar);
        const frontend = this.inspector.get_web_view();
        frontend.hexpand = true; frontend.vexpand = true;
        content.pack_start(frontend, true, true, 0);
        this.updateLocation(); return content;
    }
    private updateLocation() {
        const uri = this.inspector.get_inspected_uri() || this.view.get_uri() || 'Current page';
        this.location?.set_text(uri); this.location?.set_tooltip_text(uri);
    }
    private release() {
        const frontend = this.inspector.get_web_view();
        if (this.content && frontend?.get_parent() === this.content) this.content.remove(frontend);
        const container = this.content?.get_parent();
        if (container instanceof Gtk.Container) container.remove(this.content!);
        if (this.detached) {this.header?.destroy(); this.header = undefined; this.detached.destroy(); this.detached = undefined;}
        this.content?.destroy(); this.content = undefined; this.location = undefined; this.mode = undefined;
    }
    private openWindow() {
        this.release();
        const window = this.detached = new Gtk.ApplicationWindow({application: this.parent.application,
            title: 'Developer Tools', default_width: 1040, default_height: 620, transient_for: this.parent});
        window.name = 'browser-devtools';
        this.header = mountWindowHeader(window, {title: 'Developer Tools', iconName: 'dev-os-editor-symbolic', windowIconName: 'dev-os-browser'});
        window.add(this.build());
        window.connect('delete-event', () => {this.inspector.close(); return true;});
        window.show_all(); window.present();
    }
    private clear() {
        this.release();
    }
    dispose() {
        this.inspector.close();
        this.signals.forEach(id => this.inspector.disconnect(id)); this.signals = [];
        this.clear();
    }
}
