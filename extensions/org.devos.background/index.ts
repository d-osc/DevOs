import {
    Gtk, Gdk, GtkLayerShell, type UIContext, type Config
} from '@dev-os/core';
import Cairo from 'cairo';
import {layerWindow} from '@dev-os/services/layers';
import {mountBackground} from './view.js';
import {onTabDrag, tabDetachTarget} from '@dev-os/services/window-tabs';

export class Background {
    window: Gtk.ApplicationWindow;
    private root: ReturnType<typeof mountBackground>;
    private dragCleanup: () => void;
    constructor(context: UIContext, monitor: Gdk.Monitor, config: Config) {
        this.window = layerWindow(context.application, 'dev-os-background', GtkLayerShell.Layer.BACKGROUND,
            monitor, [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM,
                GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT]);
        GtkLayerShell.set_exclusive_zone(this.window, -1);
        this.root = mountBackground(this.window, config);
        const detach = tabDetachTarget(this.window);
        const unsubscribe = onTabDrag(active => {
            // Background normally passes pointer input through to the compositor.
            // During a tab drag it must receive the desktop drop on each monitor.
            const region = new Cairo.Region();
            if (active) region.unionRectangle({x: 0, y: 0, width: this.window.get_allocated_width(), height: this.window.get_allocated_height()});
            this.window.get_window()?.input_shape_combine_region(region, 0, 0);
        });
        this.dragCleanup = () => { unsubscribe(); detach(); };
        this.window.connect('realize', window => {
            window.get_window()!.input_shape_combine_region(new Cairo.Region(), 0, 0);
        });
        this.window.show();
    }
    destroy() { this.dragCleanup(); this.root.unmount(); this.window.destroy(); }
}
