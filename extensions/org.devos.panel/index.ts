import {
    Gtk, Gdk, GtkLayerShell, type UIContext
} from '@dev-os/core';
import {layerWindow} from '@dev-os/services/layers';
import {mountPanel} from './view.js';
import {Devices} from './devices.js';

export class Panel {
    window: Gtk.ApplicationWindow;
    private devices = new Devices();
    private view: ReturnType<typeof mountPanel>;
    constructor(context: UIContext, monitor: Gdk.Monitor) {
        this.window = layerWindow(context.application, 'dev-os-panel', GtkLayerShell.Layer.TOP, monitor,
            [GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT], GtkLayerShell.KeyboardMode.NONE);
        this.window.name = 'panel';
        this.window.set_size_request(-1, context.config().panel_height);
        GtkLayerShell.auto_exclusive_zone_enable(this.window);
        this.view = mountPanel(this.window, {config: context.config(), extensions: context.preferences,
            devices: this.devices, spacing: Number(context.preferences.get('org.devos.panel').state.values.spacing),
            windows: context.windows,
            launcher: {toggle: monitor => context.invoke('launcher', monitor)},
            runCommand: command => context.runCommand(command), showSettings: () => context.invoke('settings')}, monitor);
        this.window.show();
    }
    showMessage(message: string) { this.view.showMessage(message); }
    destroy() { this.devices.destroy(); this.view.root.unmount(); this.window.destroy(); }
}
