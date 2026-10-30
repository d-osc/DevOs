import {Gdk, Gtk, GLib, GtkLayerShell, type UIContext} from '@dev-os/core';
import {layerWindow} from '@dev-os/services/layers';
import type GdkPixbuf from 'gi://GdkPixbuf?version=2.0';

const SECONDS = 7;
/** The small card that appears after a snip (like the Windows notification): thumbnail, where it went, click to annotate. */
export class SnipToast {
    private window: Gtk.ApplicationWindow;
    private timer = 0;
    private destroyed = false;

    constructor(context: UIContext, pixbuf: GdkPixbuf.Pixbuf, message: string, private open: () => void, private closed: () => void) {
        const monitor = context.monitors()[0] ?? null;
        this.window = layerWindow(context.application, 'dev-os-snip-toast', GtkLayerShell.Layer.OVERLAY, monitor,
            [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.RIGHT]);
        GtkLayerShell.set_margin(this.window, GtkLayerShell.Edge.TOP, 56); GtkLayerShell.set_margin(this.window, GtkLayerShell.Edge.RIGHT, 16);
        GtkLayerShell.set_exclusive_zone(this.window, 0); this.window.set_app_paintable(true);
        const card = new Gtk.EventBox(); card.get_style_context().add_class('snip-toast'); card.add_events(Gdk.EventMask.BUTTON_RELEASE_MASK);
        const row = new Gtk.Box({spacing: 12, margin: 10}); card.add(row);
        const width = pixbuf.get_width(), height = pixbuf.get_height(), factor = Math.min(1, 120 / width, 80 / height);
        const thumbnail = pixbuf.scale_simple(Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor)), 2 /* BILINEAR */);
        row.pack_start(new Gtk.Image({pixbuf: thumbnail}), false, false, 0);
        const text = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, valign: Gtk.Align.CENTER});
        const title = new Gtk.Label({label: 'Snip saved', xalign: 0}); title.get_style_context().add_class('snip-toast-title');
        const detail = new Gtk.Label({label: message, xalign: 0, wrap: true, max_width_chars: 36}); detail.get_style_context().add_class('snip-toast-detail');
        text.pack_start(title, false, false, 0); text.pack_start(detail, false, false, 0); row.pack_start(text, true, true, 0);
        card.connect('button-release-event', () => { this.open(); this.destroy(); return true; });
        this.window.add(card); this.window.show_all();
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SECONDS, () => { this.timer = 0; this.destroy(); return GLib.SOURCE_REMOVE; });
    }
    destroy() {
        if (this.destroyed) return; this.destroyed = true;
        if (this.timer) GLib.source_remove(this.timer);
        this.window.destroy(); this.closed();
    }
}
