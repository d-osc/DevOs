import {Gtk, Gdk, GLib, GtkLayerShell, type UIContext} from '@dev-os/core';
import {layerWindow} from '@dev-os/services/layers';
import {readCare, carePath, watchFile, type CareSettings} from '../../../packages/compat/display-care.js';
import {NativeModel} from '../../../packages/compat/native-model.js';

/** Panel positions of Pixel Shift: the content moves inside the panel (0..2 px), so the work area never changes. */
export const PIXEL_SHIFT_SECONDS = 180;
export const AUTOHIDE_DELAY_MS = 1500;
/** The shift as margins that keep the content size constant: (left, right, top, bottom). */

/**
 * The OLED Care effects that belong to the panel itself: transparency, Pixel Shift and auto-hide with a hot edge.
 * Nothing here needs a compositor protocol beyond layer-shell.
 */
export function attachPanelCare(context: UIContext, window: Gtk.ApplicationWindow, monitor: Gdk.Monitor, position: 'top' | 'bottom', menuOpen: () => boolean): () => void {
    let settings: CareSettings = readCare(), step = 0, hideTimer = 0, edge: Gtk.ApplicationWindow | undefined, inside = false, disposed = false;
    let margins: [number, number, number, number] = [1, 1, 1, 1];
    const model = new NativeModel('src/services/display-care-compat.dev', frame => {
        if (disposed || !frame.settings || !Array.isArray(frame.margins) || frame.margins.length !== 4) return;
        const next = frame.settings as CareSettings;
        const changed = settings.panelTransparency !== next.panelTransparency || settings.autoHidePanel !== next.autoHidePanel;
        settings = next; margins = frame.margins as typeof margins; shift(); if (changed) apply();
    });
    const style = window.get_style_context();
    const submit = () => model.submit({op: 'panel', step});
    const shiftTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PIXEL_SHIFT_SECONDS, () => {step++; submit(); return GLib.SOURCE_CONTINUE;});
    function shift() {
        const child = window.get_child(); if (!child) return;
        const [left, right, top, bottom] = margins;
        child.set_margin_start(left); child.set_margin_end(right); child.set_margin_top(top); child.set_margin_bottom(bottom);
    }
    const busy = () => inside || menuOpen() || (!!context.application.get_active_window() && !window.is_active);
    const cancel = () => {if (hideTimer) {GLib.source_remove(hideTimer); hideTimer = 0;}};
    const hide = () => {
        hideTimer = 0;
        if (disposed || !settings.autoHidePanel) return GLib.SOURCE_REMOVE;
        if (busy()) {schedule(); return GLib.SOURCE_REMOVE;}
        window.hide(); edge?.show(); return GLib.SOURCE_REMOVE;
    };
    function schedule() {cancel(); hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTOHIDE_DELAY_MS, hide);}
    function reveal() {edge?.hide(); window.show(); schedule();}
    function ensureEdge() {
        if (edge) return;
        // A 2 px strip on the screen edge: pointing at it brings the panel back.
        const strip = edge = layerWindow(context.application, 'dev-os-panel-edge', GtkLayerShell.Layer.TOP, monitor,
            [position === 'top' ? GtkLayerShell.Edge.TOP : GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT]);
        GtkLayerShell.set_exclusive_zone(strip, 0); strip.set_app_paintable(true); strip.set_size_request(-1, 2);
        strip.add_events(Gdk.EventMask.ENTER_NOTIFY_MASK);
        strip.connect('enter-notify-event', () => {reveal(); return false;});
        strip.connect('draw', () => true);
    }
    window.add_events(Gdk.EventMask.ENTER_NOTIFY_MASK | Gdk.EventMask.LEAVE_NOTIFY_MASK);
    window.connect('enter-notify-event', () => {inside = true; cancel(); return false;});
    window.connect('leave-notify-event', () => {inside = false; if (settings.autoHidePanel) schedule(); return false;});
    function apply() {
        style.remove_class('panel-translucent'); style.remove_class('panel-opaque');
        style.add_class(settings.panelTransparency ? 'panel-translucent' : 'panel-opaque');
        window.queue_draw();
        if (settings.autoHidePanel) {ensureEdge(); if (window.get_visible()) schedule(); else edge!.show();}
        else {cancel(); edge?.hide(); if (!window.get_visible()) window.show();}
    }
    shift(); apply(); submit();
    const stopWatching = watchFile(carePath(), submit);
    return () => {
        disposed = true; cancel(); GLib.source_remove(shiftTimer); stopWatching(); model.destroy(); edge?.destroy(); edge = undefined;
    };
}
