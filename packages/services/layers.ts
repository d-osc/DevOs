import {
    Gtk, Gdk, GtkLayerShell
} from '@dev-os/core';

export function layerWindow(application: Gtk.Application, namespace: string, layer: GtkLayerShell.Layer,
    monitor: Gdk.Monitor | null = null, anchors: GtkLayerShell.Edge[] = [],
    keyboard: GtkLayerShell.KeyboardMode = GtkLayerShell.KeyboardMode.NONE): Gtk.ApplicationWindow {
    const window = new Gtk.ApplicationWindow({application, decorated: false, resizable: false});
    const visual = window.get_screen()!.get_rgba_visual();
    if (visual) window.set_visual(visual);
    GtkLayerShell.init_for_window(window);
    GtkLayerShell.set_namespace(window, namespace);
    GtkLayerShell.set_layer(window, layer);
    if (monitor) GtkLayerShell.set_monitor(window, monitor);
    anchors.forEach(edge => GtkLayerShell.set_anchor(window, edge, true));
    GtkLayerShell.set_keyboard_mode(window, keyboard);
    return window;
}
