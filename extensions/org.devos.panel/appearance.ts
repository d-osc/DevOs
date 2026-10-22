import {Gtk} from '@dev-os/core';
import Cairo from 'cairo';

export function preparePanelAppearance(window: Gtk.Window) {
    window.name = 'panel';
    window.set_app_paintable(true);
    // Clear the rectangular surface before painting GTK's rounded background.
    window.connect('draw', (_window, cr) => {
        // GTK also invokes this handler for native popover windows. Painting
        // the panel there adds a panel-height strip behind the popup contents.
        const surface = window.get_window();
        if (!surface || !Gtk.cairo_should_draw_window(cr, surface)) return false;
        cr.save();
        cr.setOperator(Cairo.Operator.SOURCE);
        cr.setSourceRGBA(0, 0, 0, 0);
        cr.paint();
        cr.restore();
        const style = window.get_style_context();
        Gtk.render_background(style, cr, 0, 0, window.get_allocated_width(), window.get_allocated_height());
        Gtk.render_frame(style, cr, 0, 0, window.get_allocated_width(), window.get_allocated_height());
        return false;
    });
}
