import {
    Gtk, Gdk, GtkLayerShell, type UIContext
} from '@dev-os/core';
import {layerWindow} from '@dev-os/services/layers';
import {mountLauncher} from './view.js';
import {installedApps, searchApps} from '@dev-os/services/apps';
import {launcherOptions, type LauncherOptions} from './options.js';
import {OverlayMotion} from './overlay-motion.js';
import {PackageManagerCli} from '../org.devos.appstore/package-backend.js';

// Native adapter: React owns the contents and interaction state.
export class Launcher {
    window: Gtk.ApplicationWindow;
    private view: ReturnType<typeof mountLauncher>;
    private options: LauncherOptions;
    private escape: Gtk.EventControllerKey;
    private motion: OverlayMotion;
    constructor(context: UIContext) {
        this.options = launcherOptions(context.preferences.get('org.devos.launcher').state.values);
        this.window = layerWindow(context.application, 'dev-os-launcher', GtkLayerShell.Layer.OVERLAY,
            context.display.get_primary_monitor() ?? context.display.get_monitor(0),
            [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT], GtkLayerShell.KeyboardMode.EXCLUSIVE);
        this.window.name = 'launcher';
        GtkLayerShell.set_exclusive_zone(this.window, -1);
        this.window.set_resizable(true);
        this.window.set_default_size(1, 1);
        this.motion = new OverlayMotion(this.window);
        this.view = mountLauncher(this.window, {
            motion: this.motion,
            display: context.display, installedApps, searchApps, options: this.options,
            getCustomization: () => context.preferences.get('org.devos.launcher').state.values,
            saveCustomization: patch => context.preferences.update('org.devos.launcher', true, {...context.preferences.get('org.devos.launcher').state.values, ...patch}),
            runCommand: command => context.runCommand(command),
            quit: () => context.quit(),
            uninstallApp: async command => {
                const packages = new PackageManagerCli(), item = (await packages.installed()).find(entry => entry.commands.includes(command));
                if (!item) throw new Error('This app is not a package installed from a file.');
                await packages.remove(item.id); return `${item.title} uninstalled`;
            },
            showSettings: () => context.invoke('settings'),
            openEditor: () => context.invoke('editor'),
        });
        this.window.connect('delete-event', () => this.hide());
        this.window.connect('key-press-event', (_window, event) => this.view.onKey(event as unknown as Gdk.Event));
        this.escape = new Gtk.EventControllerKey({widget: this.window, propagation_phase: Gtk.PropagationPhase.CAPTURE});
        this.escape.connect('key-pressed', (_controller, key) => key === Gdk.KEY_Escape ? this.hide() : false);
    }
    show(monitor: Gdk.Monitor | null = null) {
        if (monitor) {
            GtkLayerShell.set_monitor(this.window, monitor);
        }
        this.view.show();
    }
    hide() { return this.view.hide(); }
    toggle(monitor: Gdk.Monitor | null = null) { if (this.motion.isOpen) this.hide(); else this.show(monitor); }
    requestLogout() { this.view.requestLogout(); }
    showMessage(message: string) { this.view.showMessage(message); }
    destroy() { this.motion.dispose(); this.escape.run_dispose(); this.view.destroy(); this.window.destroy(); }
}
