import {
    Gtk, Gdk, GLib, GtkLayerShell, type UIContext
} from '@dev-os/core';
import {layerWindow} from '@dev-os/services/layers';
import {mountPanel} from './view.js';
import {Devices} from './devices.js';
import {panelOptions} from './options.js';
import {preparePanelAppearance} from './appearance.js';
import {createPanelMenu} from './context-menu.js';
import {runCustomMenuItem} from '../org.devos.files/custom-menu.js';

export class Panel {
    window: Gtk.ApplicationWindow;
    private devices = new Devices();
    private view: ReturnType<typeof mountPanel>;
    private menu?: Gtk.Menu;
    private gesture: Gtk.GestureMultiPress;
    private preferencesCleanup: () => void;
    private disposed = false;
    constructor(context: UIContext, monitor: Gdk.Monitor) {
        const options = panelOptions(context.preferences.get('org.devos.panel').state.values, context.config().panel_height);
        this.window = layerWindow(context.application, 'dev-os-panel', GtkLayerShell.Layer.TOP, monitor,
            [options.position === 'top' ? GtkLayerShell.Edge.TOP : GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT], GtkLayerShell.KeyboardMode.NONE);
        preparePanelAppearance(this.window);
        if (options.position === 'top') this.window.get_style_context().add_class('panel-top');
        this.window.set_size_request(-1, options.height);
        GtkLayerShell.auto_exclusive_zone_enable(this.window);
        this.view = mountPanel(this.window, {config: context.config(), extensions: context.preferences,
            devices: this.devices, spacing: options.spacing, options,
            windows: context.windows,
            launcher: {toggle: monitor => context.invoke('launcher', monitor)},
            toggleTaskView: monitor => context.invoke('task-view', monitor),
            showLanguage: () => context.invoke('settings.language'),
            showTime: () => context.invoke('settings.time'),
            switchUser: username => {if (username && context.application.lookup_action('devos-switch-user')) context.application.activate_action('devos-switch-user', new GLib.Variant('s', username)); else context.invoke('session.switch-user');},
            showAccounts: () => context.invoke('settings.accounts'),
            runCommand: command => context.runCommand(command), showSettings: () => context.invoke('settings'), showWifi: () => context.invoke('settings.wifi')}, monitor);
        this.gesture = new Gtk.GestureMultiPress({widget: this.window, button: 3, propagation_phase: Gtk.PropagationPhase.CAPTURE});
        this.gesture.connect('pressed', () => {
            this.gesture.set_state(Gtk.EventSequenceState.CLAIMED);
            this.menu?.destroy();
            this.menu = createPanelMenu(context.preferences.get('org.devos.panel').state.values, {
                menuPanelSettings: () => context.invoke('settings.panel'),
                menuApplications: () => context.invoke('launcher', monitor),
                menuTerminal: () => {context.runCommand('terminal', GLib.get_home_dir());},
                menuAppStore: () => context.invoke('app-store'),
                menuDiskManager: () => context.invoke('disk-manager'),
                menuTaskManager: () => context.invoke('task-manager'),
                menuFiles: () => context.invoke('files'),
                menuClockSettings: () => context.invoke('settings.clock'),
                menuSettings: () => context.invoke('settings'),
            }, item => runCustomMenuItem(item, GLib.get_home_dir(), GLib.get_home_dir(), message => {
                if (this.disposed) printerr(message); else this.showMessage(message);
            }));
            if (!this.menu.get_children().length) return;
            this.menu.attach_to_widget(this.window, null); this.menu.show_all();
            this.menu.popup_at_pointer(this.gesture.get_last_event(this.gesture.get_current_sequence()));
        });
        this.preferencesCleanup = context.preferences.subscribe(() => {this.menu?.destroy(); this.menu = undefined;});
        this.window.show();
    }
    showMessage(message: string) { this.view.showMessage(message); }
    destroy() { this.disposed = true; this.preferencesCleanup(); this.menu?.destroy(); this.gesture.run_dispose(); this.devices.destroy(); this.view.root.unmount(); this.window.destroy(); }
}
