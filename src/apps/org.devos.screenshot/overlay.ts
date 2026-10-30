import Cairo from 'cairo';
import {Gdk, Gtk, GtkLayerShell, type UIContext} from '@dev-os/core';
import {layerWindow} from '@dev-os/services/layers';
import type GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import {cropFreeform, cropRectangle, type Frame} from './capture.js';
import {SNIP_MODES, normalizeRect, scaleRect, thin, usable, type Point, type Rect, type SnipMode} from './geometry.js';

const allEdges = [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT];
export interface Snip {pixbuf: GdkPixbuf.Pixbuf;}

/**
 * The Win+Shift+S overlay: the frozen desktop is shown dimmed on every monitor, with a mode bar on the monitor under the
 * pointer. The snip is cut from the frozen frame, so what the user sees is exactly what is saved.
 */
export class SnipOverlay {
    private windows: {window: Gtk.ApplicationWindow; area: Gtk.DrawingArea; geometry: Rect}[] = [];
    private mode: SnipMode;
    private start: Point | null = null;
    private current: Point | null = null;
    private outline: Point[] = [];
    private hover: Rect | null = null;
    private buttons = new Map<SnipMode, Gtk.ToggleButton>();
    private syncing = false;
    private finished = false;

    constructor(private context: UIContext, private frame: Frame, mode: SnipMode, private done: (snip: Snip | null) => void) {
        this.mode = mode;
        const display = context.display;
        const [, px, py] = display.get_default_seat()!.get_pointer()!.get_position();
        const pointerMonitor = display.get_monitor_at_point(px, py) ?? context.monitors()[0];
        for (const monitor of context.monitors()) {
            const geometry = monitor.get_geometry();
            const window = layerWindow(context.application, 'dev-os-snip', GtkLayerShell.Layer.OVERLAY, monitor, allEdges,
                monitor === pointerMonitor ? GtkLayerShell.KeyboardMode.EXCLUSIVE : GtkLayerShell.KeyboardMode.NONE);
            GtkLayerShell.set_exclusive_zone(window, -1); window.set_resizable(true); window.set_app_paintable(true); window.set_can_focus(true);
            window.get_style_context().add_class('snip-overlay');
            const area = new Gtk.DrawingArea({hexpand: true, vexpand: true});
            area.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK | Gdk.EventMask.POINTER_MOTION_MASK);
            const rect: Rect = {x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height};
            area.connect('draw', (_widget, cr) => { this.paint(cr, rect); return true; });
            area.connect('button-press-event', (_widget, event) => this.press(event, rect));
            area.connect('motion-notify-event', (_widget, event) => this.motion(event, rect));
            area.connect('button-release-event', (_widget, event) => this.release(event, rect));
            const layer = new Gtk.Overlay(); layer.add(area);
            if (monitor === pointerMonitor) layer.add_overlay(this.toolbar());
            window.add(layer);
            window.connect('key-press-event', (_widget, event) => this.key(event));
            window.connect('realize', () => window.get_window()?.set_cursor(Gdk.Cursor.new_from_name(display, 'crosshair')));
            window.show_all(); window.present();
            this.windows.push({window, area, geometry: rect});
        }
        if (!this.windows.length) this.finish(null);
    }

    private toolbar(): Gtk.Widget {
        const bar = new Gtk.Box({spacing: 6, halign: Gtk.Align.CENTER, valign: Gtk.Align.START, margin_top: 28});
        bar.get_style_context().add_class('snip-toolbar');
        for (const mode of SNIP_MODES) {
            const button = new Gtk.ToggleButton({label: mode.label, active: mode.id === this.mode, tooltip_text: mode.label});
            button.get_style_context().add_class('snip-mode');
            button.connect('toggled', () => {
                if (this.syncing) return;
                if (!button.active) { this.syncing = true; button.active = true; this.syncing = false; return; }
                this.setMode(mode.id);
            });
            this.buttons.set(mode.id, button); bar.pack_start(button, false, false, 0);
        }
        const close = new Gtk.Button({label: 'Close', tooltip_text: 'Cancel (Esc)'}); close.get_style_context().add_class('snip-close');
        close.connect('clicked', () => this.finish(null)); bar.pack_start(close, false, false, 0);
        return bar;
    }
    private setMode(mode: SnipMode) {
        this.mode = mode; this.start = this.current = null; this.outline = []; this.hover = null;
        this.syncing = true; for (const [id, button] of this.buttons) button.active = id === mode; this.syncing = false;
        this.redraw();
    }
    private redraw() { for (const entry of this.windows) entry.area.queue_draw(); }

    private global(event: Gdk.EventButton | Gdk.EventMotion, rect: Rect): Point {
        const [, x, y] = (event as unknown as Gdk.Event).get_coords();
        return {x: rect.x + x, y: rect.y + y};
    }
    private press(event: Gdk.EventButton, rect: Rect): boolean {
        const button = (event as unknown as Gdk.Event).get_button()[1];
        if (button === 3) { this.finish(null); return true; }
        if (button !== 1) return false;
        const point = this.global(event, rect);
        if (this.mode === 'fullscreen') { this.finish(this.fullMonitor(rect)); return true; }
        this.start = point; this.current = point; this.outline = [point];
        return true;
    }
    private motion(event: Gdk.EventMotion, rect: Rect): boolean {
        const point = this.global(event, rect);
        if (this.mode === 'fullscreen') { this.hover = rect; this.redraw(); return true; }
        if (!this.start) return false;
        this.current = point;
        if (this.mode === 'freeform') this.outline.push(point);
        this.redraw();
        return true;
    }
    private release(event: Gdk.EventButton, rect: Rect): boolean {
        const button = (event as unknown as Gdk.Event).get_button()[1];
        if (button !== 1 || !this.start) return false;
        const point = this.global(event, rect);
        if (this.mode === 'rectangle') {
            const selection = normalizeRect(this.start, point);
            if (usable(selection)) { this.finish(this.rectangleSnip(selection)); return true; }
        } else if (this.mode === 'freeform') {
            this.finish(cropFreeform(this.frame, thin(this.outline)).then(pixbuf => pixbuf ? {pixbuf} : null)); return true;
        }
        this.start = this.current = null; this.outline = []; this.redraw();
        return true;
    }
    private key(event: Gdk.EventKey): boolean {
        const keyval = (event as unknown as Gdk.Event).get_keyval()[1];
        if (keyval === Gdk.KEY_Escape) { this.finish(null); return true; }
        if (keyval === Gdk.KEY_Return && this.mode === 'fullscreen') {
            const target = this.hover ?? this.windows[0]?.geometry; if (target) this.finish(this.fullMonitor(target)); return true;
        }
        const shortcuts: Record<number, SnipMode> = {[Gdk.KEY_r]: 'rectangle', [Gdk.KEY_f]: 'freeform', [Gdk.KEY_s]: 'fullscreen'};
        const mode = shortcuts[keyval];
        if (mode) { this.setMode(mode); return true; }
        return false;
    }
    private async rectangleSnip(selection: Rect): Promise<Snip | null> {
        const pixbuf = await cropRectangle(this.frame, selection);
        return pixbuf ? {pixbuf} : null;
    }
    private fullMonitor(rect: Rect): Promise<Snip | null> { return this.rectangleSnip(rect); }

    private paint(cr: Cairo.Context, monitor: Rect) {
        const frame = this.frame, scale = frame.scale;
        const source = scaleRect({x: monitor.x - frame.bounds.x, y: monitor.y - frame.bounds.y, width: monitor.width, height: monitor.height}, scale);
        cr.save(); cr.scale(1 / scale, 1 / scale);
        Gdk.cairo_set_source_pixbuf(cr, frame.pixbuf, -source.x, -source.y); cr.paint(); cr.restore();
        cr.setSourceRGBA(0, 0, 0, 0.5); cr.paint();
        const selection = this.selectionPath(cr, monitor);
        if (!selection) return;
        cr.save(); cr.clip(); cr.scale(1 / scale, 1 / scale);
        Gdk.cairo_set_source_pixbuf(cr, frame.pixbuf, -source.x, -source.y); cr.paint(); cr.restore();
        this.selectionPath(cr, monitor);
        cr.setSourceRGBA(1, 1, 1, 0.95); cr.setLineWidth(1.5); cr.stroke();
    }
    /** Adds the current selection to the path (in this monitor's coordinates); false when there is none. */
    private selectionPath(cr: Cairo.Context, monitor: Rect): boolean {
        if (this.mode === 'fullscreen') {
            if (!this.hover || this.hover.x !== monitor.x || this.hover.y !== monitor.y) return false;
            cr.rectangle(2, 2, monitor.width - 4, monitor.height - 4); return true;
        }
        if (!this.start || !this.current) return false;
        if (this.mode === 'rectangle') {
            const rect = normalizeRect(this.start, this.current);
            if (rect.width < 1 || rect.height < 1) return false;
            cr.rectangle(rect.x - monitor.x, rect.y - monitor.y, rect.width, rect.height); return true;
        }
        if (this.outline.length < 2) return false;
        this.outline.forEach((point, index) => {
            if (index === 0) cr.moveTo(point.x - monitor.x, point.y - monitor.y); else cr.lineTo(point.x - monitor.x, point.y - monitor.y);
        });
        cr.closePath(); return true;
    }

    private finish(snip: Snip | null | Promise<Snip | null>) {
        if (this.finished) return;
        this.finished = true;
        for (const entry of this.windows) entry.window.destroy();
        this.windows = [];
        void Promise.resolve(snip).then(value => this.done(value), error => {printerr(`Screenshot crop failed: ${String(error)}`); this.done(null);});
    }
    destroy() { this.finish(null); }
}
