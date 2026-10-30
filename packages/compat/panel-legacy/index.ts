import {
    Gtk, Gdk, GLib, GtkLayerShell, type UIContext
} from '@dev-os/core';
import {layerWindow} from '@dev-os/services/layers';
import {mountPanel, panelTaskAt} from './view.js';
import {Devices} from './devices.js';
import {panelOptions} from './options.js';
import {attachPanelCare} from './panel-care.js';
import {preparePanelAppearance} from './appearance.js';
import {createPreparedPanelMenu} from './context-menu.js';
import {subscribePanelMenu, type PanelMenuRow} from '../../../packages/compat/panel-menu.js';
import {NativeAction} from '../../../packages/compat/native-action.js';
import {PanelTaskbar} from '../../../packages/compat/panel-taskbar.js';
import {Gio} from '@dev-os/core';

export class Panel {
    window: Gtk.ApplicationWindow;
    private devices = new Devices();
    private view: ReturnType<typeof mountPanel>;
    private menu?: Gtk.Menu;
    private gesture: Gtk.GestureMultiPress;
    private preferencesCleanup: () => void;
    private careCleanup: () => void;
    private disposed = false;
    private menuData: ReturnType<typeof subscribePanelMenu>;
    private menuRows?: PanelMenuRow[];
    private menuPosition?: {x: number; y: number};
    private menuActions = new NativeAction('src/services/panel-menu-plan.dev');
    private taskbar: PanelTaskbar;
    constructor(context: UIContext, monitor: Gdk.Monitor) {
        const options = panelOptions(context.preferences.get('org.devos.panel').state.values, context.config().panel_height);
        this.taskbar = new PanelTaskbar(context.windows, options.showPinned);
        this.window = layerWindow(context.application, 'dev-os-panel', GtkLayerShell.Layer.TOP, monitor,
            [options.position === 'top' ? GtkLayerShell.Edge.TOP : GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT], GtkLayerShell.KeyboardMode.NONE);
        preparePanelAppearance(this.window);
        if (options.position === 'top') this.window.get_style_context().add_class('panel-top');
        this.window.set_size_request(-1, options.height);
        GtkLayerShell.auto_exclusive_zone_enable(this.window);
        this.view = mountPanel(this.window, {config: context.config(), extensions: context.preferences,
            devices: this.devices, spacing: options.spacing, options,
            windows: context.windows,
            taskbar: this.taskbar,
            launcher: {toggle: monitor => context.invoke('launcher', monitor)},
            toggleTaskView: monitor => context.invoke('task-view', monitor),
            showLanguage: () => context.invoke('settings.language'),
            showTime: () => context.invoke('settings.time'),
            switchUser: username => {if (username && context.application.lookup_action('devos-switch-user')) context.application.activate_action('devos-switch-user', new GLib.Variant('s', username)); else context.invoke('session.switch-user');},
            showAccounts: () => context.invoke('settings.accounts'),
            runCommand: command => context.runCommand(command), showSettings: () => context.invoke('settings'), showWifi: () => context.invoke('settings.wifi')}, monitor);
        const openMenu = () => {
            if (this.disposed || !this.menuPosition || !this.menuRows) return;
            const {x, y} = this.menuPosition; this.menuPosition = undefined; this.menu?.destroy();
            this.menu = createPreparedPanelMenu(this.menuRows, (key, title) => {
                void this.menuActions.request<{ok: boolean; plan: {kind: string; key?: string; command?: string; argv?: string[]; cwd: string}}>({values: context.preferences.get('org.devos.panel').state.values, key}).then(({plan}) => {
                    if (this.disposed) return;
                    if (plan.kind === 'shell') {if (plan.command === 'terminal') context.runCommand('terminal', plan.cwd); else context.invoke(plan.command!, monitor); return;}
                    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE}); launcher.set_cwd(plan.cwd);
                    const process = launcher.spawnv(plan.argv!); process.wait_check_async(null, (_source, result) => {try {process.wait_check_finish(result);} catch (error) {if (!this.disposed) this.showMessage(`${title}: ${String(error)}`);}});
                }).catch(error => {if (!this.disposed) this.showMessage(`${title}: ${String(error)}`);});
            });
            if (!this.menu.get_children().length) return;
            this.menu.attach_to_widget(this.window, null); this.menu.show_all();
            this.menu.popup_at_rect(this.window.get_window()!, new Gdk.Rectangle({x: Math.round(x), y: Math.round(y), width: 1, height: 1}), Gdk.Gravity.SOUTH_WEST, Gdk.Gravity.NORTH_WEST, null);
        };
        this.menuData = subscribePanelMenu(context.preferences.get('org.devos.panel').state.values, rows => {this.menuRows = rows; openMenu();});
        this.gesture = new Gtk.GestureMultiPress({widget: this.window, button: 3, propagation_phase: Gtk.PropagationPhase.CAPTURE});
        this.gesture.connect('pressed', (_gesture, _count, x, y) => {
            if (panelTaskAt(this.window, x, y)) return;
            this.gesture.set_state(Gtk.EventSequenceState.CLAIMED);
            this.menuPosition = {x, y}; openMenu();
        });
        this.preferencesCleanup = context.preferences.subscribe(() => {this.menu?.destroy(); this.menu = undefined; this.menuRows = undefined; this.menuPosition = undefined; this.menuData.update(context.preferences.get('org.devos.panel').state.values);});
        this.window.show();
        this.careCleanup = attachPanelCare(context, this.window, monitor, options.position, () => !!this.menu?.get_visible());
    }
    showMessage(message: string) { this.view.showMessage(message); }
    destroy() { this.disposed = true; this.taskbar.destroy(); this.menuData.destroy(); this.menuActions.destroy(); this.careCleanup(); this.preferencesCleanup(); this.menu?.destroy(); this.gesture.run_dispose(); this.devices.destroy(); this.view.root.unmount(); this.window.destroy(); }
}
