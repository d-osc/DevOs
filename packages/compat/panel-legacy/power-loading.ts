import {Gdk, Gio, GLib, Gtk, GtkLayerShell} from '@dev-os/core';
import {layerWindow} from '@dev-os/services/layers';
import type {PowerAction} from './power.js';

/** Covers the desktop until logind tears down the compositor. No terminal is launched. */
export class PowerLoading {
    private windows: Gtk.Window[] = [];
    private sources = new Set<number>();
    private disposed = false;
    private finishReady: () => void = () => {};
    readonly ready: Promise<void>;
    constructor(action: Exclude<PowerAction, 'sleep'>, createWindow?: (monitor: Gdk.Monitor) => Gtk.Window) {
        this.ready = new Promise(resolve => {this.finishReady = resolve;});
        const display = Gdk.Display.get_default(), application = Gio.Application.get_default();
        if (!display) {this.finishReady(); return;}
        const css = new Gtk.CssProvider();
        css.load_from_data(new TextEncoder().encode('#devos-power-loading {background:#242424;color:#bfbfbf;} #devos-power-loading spinner {color:#3994bc;} #devos-power-loading label {font-size:20px;}'));
        for (let index = 0; index < display.get_n_monitors(); index++) {
            const monitor = display.get_monitor(index)!;
            const window = createWindow ? createWindow(monitor) : application instanceof Gtk.Application && GtkLayerShell.is_supported()
                ? layerWindow(application, 'dev-os-power-loading', GtkLayerShell.Layer.OVERLAY, monitor,
                    [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT], GtkLayerShell.KeyboardMode.EXCLUSIVE)
                : new Gtk.Window({decorated: false, skip_taskbar_hint: true});
            window.name = 'devos-power-loading';
            window.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 24, halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER});
            const spinner = new Gtk.Spinner({width_request: 48, height_request: 48, halign: Gtk.Align.CENTER});
            spinner.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            const label = new Gtk.Label({label: action === 'restart' ? 'Restarting…' : 'Shutting down…'});
            label.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            box.pack_start(spinner, false, false, 0); box.pack_start(label, false, false, 0);
            window.add(box); window.connect('delete-event', () => true);
            let painted = false;
            window.connect('draw', () => {
                if (!painted) {painted = true; this.later(1, () => this.finishReady());}
                return false;
            });
            this.windows.push(window);
            if (!GtkLayerShell.is_layer_window(window)) window.fullscreen_on_monitor(window.get_screen()!, index);
            else GtkLayerShell.set_exclusive_zone(window, -1);
            window.show_all(); spinner.start();
        }
        // Never hold a power request indefinitely if the compositor stops repainting.
        this.later(1000, () => this.finishReady());
        this.later(90000, () => this.destroy());
    }
    private later(delay: number, callback: () => void) {
        const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this.sources.delete(source); if (!this.disposed) callback(); return GLib.SOURCE_REMOVE;
        });
        this.sources.add(source);
    }
    destroy() {
        if (this.disposed) return;
        this.disposed = true; this.finishReady();
        for (const source of this.sources) GLib.source_remove(source);
        this.sources.clear();
        for (const window of this.windows) window.destroy();
        this.windows = [];
    }
}
