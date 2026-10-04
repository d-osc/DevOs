import {Gtk, Gdk, GtkLayerShell} from '../../src/gtk.js';
import {layerWindow} from '../../src/layers.js';
import {mountLauncher} from './view.js';
import type {UIContext} from '../../src/extensions/runtime.js';
import {installedApps, searchApps} from '../../src/apps.js';
import Cairo from 'cairo';

// Native adapter: React owns the contents and interaction state.
export class Launcher {
    window: Gtk.ApplicationWindow;
    private backdrop: Gtk.ApplicationWindow;
    private view: ReturnType<typeof mountLauncher>;
    constructor(context: UIContext) {
        this.backdrop = layerWindow(context.application, 'dev-os-launcher-backdrop', GtkLayerShell.Layer.OVERLAY,
            null, [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT]);
        this.backdrop.name = 'launcher-backdrop';
        this.backdrop.set_app_paintable(true);
        GtkLayerShell.set_exclusive_zone(this.backdrop, -1);
        this.backdrop.connect('draw', (_window, cr) => {
            cr.setOperator(Cairo.Operator.SOURCE); cr.setSourceRGBA(0, 0, 0, 0); cr.paint();
            return true;
        });
        // Finish the pointer click before unmapping its surface, preserving the seat's grab state.
        this.backdrop.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK);
        this.backdrop.connect('button-press-event', () => true);
        this.backdrop.connect('button-release-event', () => this.hide());
        this.window = layerWindow(context.application, 'dev-os-launcher', GtkLayerShell.Layer.OVERLAY,
            null, [], GtkLayerShell.KeyboardMode.EXCLUSIVE);
        this.window.name = 'launcher';
        // Clear the alpha channel before GTK paints the rounded menu and its children.
        this.window.set_app_paintable(true);
        this.window.connect('draw', (_window, cr) => {
            cr.save(); cr.setOperator(Cairo.Operator.SOURCE); cr.setSourceRGBA(0, 0, 0, 0); cr.paint(); cr.restore();
            const style = this.window.get_style_context();
            const width = this.window.get_allocated_width(), height = this.window.get_allocated_height();
            Gtk.render_background(style, cr, 0, 0, width, height);
            Gtk.render_frame(style, cr, 0, 0, width, height);
            return false;
        });
        this.window.set_default_size(600, 600);
        this.view = mountLauncher(this.window, {
            display: context.display, installedApps, searchApps,
            runCommand: command => context.runCommand(command),
            quit: () => context.quit(),
            showSettings: () => context.invoke('settings'),
            openEditor: () => context.invoke('editor'),
        });
        this.window.connect('delete-event', () => this.hide());
        this.window.connect('hide', () => this.backdrop.hide());
        this.window.connect('key-press-event', (_window, event) => this.view.onKey(event as unknown as Gdk.Event));
    }
    show(monitor: Gdk.Monitor | null = null) {
        if (monitor) {
            this.window.set_size_request(Math.min(600, Math.max(300, monitor.get_geometry().width - 48)), -1);
            this.window.resize(1, 1); GtkLayerShell.set_monitor(this.window, monitor);
            GtkLayerShell.set_monitor(this.backdrop, monitor);
        }
        // Map the backdrop first so the menu remains above it and receives its own clicks.
        this.backdrop.show();
        this.view.show();
    }
    hide() { return this.view.hide(); }
    toggle(monitor: Gdk.Monitor | null = null) { if (this.window.get_visible()) this.hide(); else this.show(monitor); }
    requestLogout() { this.view.requestLogout(); }
    showMessage(message: string) { this.view.showMessage(message); }
    destroy() { this.view.destroy(); this.window.destroy(); this.backdrop.destroy(); }
}
