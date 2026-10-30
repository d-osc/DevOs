import {Gtk, GtkLayerShell, GLib} from '@dev-os/core';

/** A fixed-size overlay: animate painting/position without resizing app layouts. */
export class OverlayMotion {
    readonly content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true, vexpand: true});
    private overlay = new Gtk.Overlay({hexpand: true, vexpand: true});
    private tick = 0;
    private progress = 0;
    private disposed = false;
    private completed?: () => void;
    isOpen = false;
    constructor(private window: Gtk.Window) {
        window.get_style_context().add_class('animated-overlay');
        this.content.get_style_context().add_class('overlay-motion-content');
        const space = new Gtk.DrawingArea({hexpand: true, vexpand: true});
        this.overlay.add(space); this.overlay.add_overlay(this.content); window.add(this.overlay);
        this.overlay.connect('get-child-position', (_overlay, child, allocation) => {
            if (child !== this.content) return false;
            allocation.x = 0; allocation.y = Math.round(20 * (1 - this.progress));
            allocation.width = Math.max(this.overlay.get_allocated_width(), this.content.get_preferred_width()[0]);
            allocation.height = Math.max(this.overlay.get_allocated_height(), this.content.get_preferred_height()[0]);
            return true;
        });
        space.show(); this.content.show(); this.overlay.show();
    }
    private paint(value: number, final = false) {
        // A fully transparent Wayland buffer may stop receiving frame callbacks.
        // Keep one faint painted frame until the transition actually completes.
        this.progress = value; this.content.set_opacity(final ? value : Math.max(0.01, value));
        this.overlay.queue_allocate(); this.content.queue_draw();
    }
    private animate(open: boolean, completed?: () => void) {
        if (this.disposed) return;
        if (this.tick) {GLib.source_remove(this.tick); this.tick = 0;}
        this.isOpen = open; this.completed = completed;
        GtkLayerShell.set_keyboard_mode(this.window, open ? GtkLayerShell.KeyboardMode.EXCLUSIVE : GtkLayerShell.KeyboardMode.NONE);
        this.content.set_sensitive(open);
        const target = open ? 1 : 0, from = this.progress;
        const finish = () => {
            this.paint(target, true);
            if (!open) this.window.hide();
            const callback = this.completed; this.completed = undefined; callback?.();
        };
        if (open) {this.paint(from); this.window.show();}
        if ((!open && !this.window.visible) || !Gtk.Settings.get_default()?.gtk_enable_animations) {finish(); return;}
        let started = 0;
        const duration = (open ? 220 : 150) * Math.abs(target - from);
        if (!duration) {finish(); return;}
        // Timer-driven progress also works when Wayland pauses frame callbacks
        // for a newly mapped/transparent surface; GTK coalesces queued draws.
        this.tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8, () => {
            const now = GLib.get_monotonic_time() / 1000;
            if (!this.window.get_mapped()) {
                if (!open) {this.tick = 0; finish(); return false;}
                return true;
            }
            if (!started) started = now;
            const elapsed = Math.min(1, (now - started) / duration);
            this.paint(from + (target - from) * (1 - Math.pow(1 - elapsed, 3)));
            if (elapsed < 1) return true;
            this.tick = 0; finish(); return false;
        });
    }
    show() {if (!this.isOpen || this.progress < 1) this.animate(true);}
    hide(completed?: () => void) {if (this.isOpen) this.animate(false, completed); else if (!this.window.visible) completed?.();}
    dispose() {this.disposed = true; this.completed = undefined; if (this.tick) GLib.source_remove(this.tick); this.tick = 0;}
}
