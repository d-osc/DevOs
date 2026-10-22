import {
    Gtk, Gdk, GLib, GtkLayerShell, React, type UIContext, type Config, type SettingsValues
} from '@dev-os/core';
import Cairo from 'cairo';
import {layerWindow} from '@dev-os/services/layers';
import {mountBackground, BackgroundView} from './view.js';
import {wallpaperConfig} from './wallpaper.js';
import {tabDetachTarget} from '@dev-os/services/window-tabs';
import {createBackgroundMenu} from './context-menu.js';
import {runCustomMenuItem} from '../org.devos.files/custom-menu.js';
import {activeWidgetDesktop, desktopWidgetValues, updateDesktopWidgets, initializeDesktopWidgets} from './widget-desktops.js';

export class Background {
    window: Gtk.ApplicationWindow;
    private root: ReturnType<typeof mountBackground>;
    private dragCleanup: () => void;
    private preferencesCleanup: () => void;
    private windowsCleanup?: () => void;
    private menu?: Gtk.Menu;
    private gesture: Gtk.GestureMultiPress;
    private dialogs = new Set<Gtk.MessageDialog>();
    private disposed = false;
    constructor(context: UIContext, monitor: Gdk.Monitor, config: Config) {
        this.window = layerWindow(context.application, 'dev-os-background', GtkLayerShell.Layer.BACKGROUND,
            monitor, [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM,
                GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT]);
        GtkLayerShell.set_exclusive_zone(this.window, -1);
        this.window.set_resizable(true);
        const appearance = () => wallpaperConfig(context.config(), context.preferences.get('org.devos.background').state.values);
        const widgetValues = () => context.preferences.get('org.devos.background').state.values;
        const viewProps = () => {
            const desktop = activeWidgetDesktop(context.windows);
            if (desktop && desktop.key !== 'default' && widgetValues().widgetDesktopVersion !== 1)
                context.preferences.update('org.devos.background', true, initializeDesktopWidgets(widgetValues(), desktop));
            return {config: appearance(), widgets: desktopWidgetValues(widgetValues(), desktop),
                changed: (patch: SettingsValues) => {
                    if (!this.disposed && desktop) context.preferences.update('org.devos.background', true, updateDesktopWidgets(widgetValues(), desktop, patch));
                }, desktopKey: desktop?.key ?? 'pending'};
        };
        const initial = viewProps();
        this.root = mountBackground(this.window, initial.config, initial.widgets, initial.changed, initial.desktopKey);
        const render = () => this.root.render(React.createElement(BackgroundView, viewProps()));
        this.preferencesCleanup = context.preferences.subscribe(() => {
            this.menu?.destroy(); this.menu = undefined;
            render();
        });
        let previousDesktop = initial.desktopKey;
        this.windowsCleanup = context.windows?.subscribe(() => {
            const desktop = activeWidgetDesktop(context.windows)?.key ?? 'pending';
            if (desktop !== previousDesktop) { previousDesktop = desktop; render(); }
        });
        const detach = tabDetachTarget(this.window);
        const updateInput = () => {
            // Own desktop input even when the menu is off, so the compositor's
            // fallback root menu cannot bypass the user's menu preferences.
            const region = new Cairo.Region();
            region.unionRectangle({x: 0, y: 0, width: this.window.get_allocated_width(), height: this.window.get_allocated_height()});
            this.window.get_window()?.input_shape_combine_region(region, 0, 0);
        };
        this.dragCleanup = detach;
        this.window.connect('realize', updateInput);
        this.window.connect('size-allocate', updateInput);
        this.gesture = new Gtk.GestureMultiPress({widget: this.window.get_child()!, button: 3, propagation_phase: Gtk.PropagationPhase.CAPTURE});
        this.gesture.connect('pressed', () => {
            this.gesture.set_state(Gtk.EventSequenceState.CLAIMED);
            this.menu?.destroy();
            this.menu = createBackgroundMenu(context.preferences.get('org.devos.background').state.values, {
                menuApplications: () => context.invoke('launcher', monitor),
                menuTerminal: () => {context.runCommand('terminal', GLib.get_home_dir());},
                menuFiles: () => context.invoke('files'),
                menuBackground: () => context.invoke('settings.background'),
                menuWidgets: () => context.invoke('settings.background'),
                menuSettings: () => context.invoke('settings'),
                menuReload: () => {context.reload();},
                menuLock: () => {context.runCommand('lock');},
                menuLogout: () => context.invoke('logout', monitor),
            }, item => runCustomMenuItem(item, GLib.get_home_dir(), GLib.get_home_dir(), message => {
                if (this.disposed) {printerr(message); return;}
                const dialog = new Gtk.MessageDialog({application: context.application, title: 'Desktop action failed', text: message, message_type: Gtk.MessageType.ERROR, buttons: Gtk.ButtonsType.CLOSE});
                this.dialogs.add(dialog); dialog.connect('response', () => {this.dialogs.delete(dialog); dialog.destroy();}); dialog.show();
            }));
            if (!this.menu.get_children().length) return;
            this.menu.attach_to_widget(this.window, null); this.menu.show_all();
            this.menu.popup_at_pointer(this.gesture.get_last_event(this.gesture.get_current_sequence()));
        });
        this.window.show();
    }
    destroy() { this.disposed = true; this.windowsCleanup?.(); this.preferencesCleanup(); this.menu?.destroy(); this.gesture.run_dispose(); for (const dialog of this.dialogs) dialog.destroy(); this.dialogs.clear(); this.dragCleanup(); this.root.unmount(); this.window.destroy(); }
}
