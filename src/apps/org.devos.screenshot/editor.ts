import Cairo from 'cairo';
import {Gdk, Gio, GLib, Gtk, mountWindowHeader, type UIContext} from '@dev-os/core';
import type GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import {copySnip, screenshotFolder, annotatedImage, saveImageAs, openScreenshotFolder} from './capture.js';
import {DELAYS, SNIP_MODES, thin, type Point, type SnipMode} from './geometry.js';

export {PALETTE, drawStrokes, renderAnnotated} from './drawing.js';
import {PALETTE, drawStrokes, type Tool, type Stroke} from './drawing.js';
export type {Tool, Stroke} from './drawing.js';
export interface EditorActions {newSnip(mode: SnipMode, delay: number): void; closed(): void;}

/** The Screenshot window: shows the last snip with pen and highlighter, and starts new snips with a mode and a delay. */
export class SnipEditor {
    readonly window: Gtk.ApplicationWindow;
    private header: ReturnType<typeof mountWindowHeader>;
    private area = new Gtk.DrawingArea({hexpand: true, vexpand: true});
    private status = new Gtk.Label({xalign: 0, wrap: true, selectable: true});
    private strokes: Stroke[] = [];
    private drawing: Stroke | null = null;
    private tool: Tool = 'pen';
    private color = PALETTE[0]!.rgb;
    private pixbuf: GdkPixbuf.Pixbuf | null = null;
    private path: string | null = null;
    private mode: SnipMode = 'rectangle';
    private delay = 0;
    private destroyed = false;
    private save = new Gtk.Button({label: 'Save'});
    private copy = new Gtk.Button({label: 'Copy'});
    private undo = new Gtk.Button({label: 'Undo'});
    private tools: Gtk.Widget[] = [];

    constructor(context: UIContext, private actions: EditorActions) {
        this.window = new Gtk.ApplicationWindow({application: context.application, title: 'Screenshot', default_width: 980, default_height: 680});
        this.window.get_style_context().add_class('snip-window');
        const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12, margin: 16}); this.window.add(body);
        this.header = mountWindowHeader(this.window, {title: 'Screenshot', iconName: 'dev-os-screenshot-symbolic', windowIconName: 'dev-os-screenshot'});

        const top = new Gtk.Box({spacing: 8});
        const fresh = new Gtk.Button({label: 'New snip'}); fresh.get_style_context().add_class('suggested-action');
        const modes = new Gtk.ComboBoxText(); SNIP_MODES.forEach(mode => modes.append(mode.id, mode.label)); modes.set_active_id(this.mode);
        const delays = new Gtk.ComboBoxText(); DELAYS.forEach(seconds => delays.append(String(seconds), seconds ? `${seconds} seconds delay` : 'No delay')); delays.set_active_id('0');
        modes.connect('changed', () => { this.mode = (modes.get_active_id() as SnipMode) ?? 'rectangle'; });
        delays.connect('changed', () => { this.delay = Number(delays.get_active_id() ?? 0); });
        fresh.connect('clicked', () => this.actions.newSnip(this.mode, this.delay));
        top.pack_start(fresh, false, false, 0); top.pack_start(modes, false, false, 0); top.pack_start(delays, false, false, 0);
        const folder = new Gtk.Button({label: 'Open folder'}); folder.connect('clicked', () => this.openFolder());
        top.pack_end(folder, false, false, 0); top.pack_end(this.save, false, false, 0); top.pack_end(this.copy, false, false, 0);
        body.pack_start(top, false, false, 0);

        const tools = new Gtk.Box({spacing: 6}); tools.get_style_context().add_class('snip-tools');
        const pen = new Gtk.RadioButton({label: 'Pen', draw_indicator: false}), highlighter = new Gtk.RadioButton({label: 'Highlighter', draw_indicator: false, group: pen});
        pen.connect('toggled', () => { if (pen.active) this.tool = 'pen'; }); highlighter.connect('toggled', () => { if (highlighter.active) this.tool = 'highlighter'; });
        tools.pack_start(pen, false, false, 0); tools.pack_start(highlighter, false, false, 0);
        for (const swatch of PALETTE) {
            const button = new Gtk.Button({tooltip_text: swatch.name}); button.get_style_context().add_class('snip-swatch');
            const provider = new Gtk.CssProvider();
            provider.load_from_data(`button { background: rgb(${swatch.rgb.map(v => Math.round(v * 255)).join(',')}); min-width: 22px; min-height: 22px; padding: 0; border-radius: 11px; }`);
            button.get_style_context().add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            button.connect('clicked', () => { this.color = swatch.rgb; }); tools.pack_start(button, false, false, 0);
        }
        const clear = new Gtk.Button({label: 'Clear marks'});
        this.undo.connect('clicked', () => { this.strokes.pop(); this.update(); });
        clear.connect('clicked', () => { this.strokes = []; this.update(); });
        tools.pack_end(clear, false, false, 0); tools.pack_end(this.undo, false, false, 0);
        this.tools = [pen, highlighter, clear, tools];
        body.pack_start(tools, false, false, 0);

        const frame = new Gtk.Frame(); frame.get_style_context().add_class('snip-canvas');
        frame.add(this.area); body.pack_start(frame, true, true, 0);
        this.status.get_style_context().add_class('media-status'); body.pack_start(this.status, false, false, 0);

        this.area.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK | Gdk.EventMask.POINTER_MOTION_MASK);
        this.area.connect('draw', (_widget, cr) => { this.paint(cr); return true; });
        this.area.connect('button-press-event', (_widget, event) => this.press(event));
        this.area.connect('motion-notify-event', (_widget, event) => this.move(event));
        this.area.connect('button-release-event', () => { this.drawing = null; return true; });
        this.copy.connect('clicked', () => this.copyImage()); this.save.connect('clicked', () => this.saveAs());
        this.window.connect('delete-event', () => { this.destroy(); return true; });
        body.show_all(); this.update();
        this.status.label = 'Press New snip, or Win+Shift+S anywhere, to capture part of the screen.';
    }

    show() { this.window.show(); this.window.present(); }
    hide() { this.window.hide(); }
    /** Shows a new snip (already saved at `path` and on the clipboard). */
    setSnip(pixbuf: GdkPixbuf.Pixbuf, path: string | null) {
        this.pixbuf = pixbuf; this.path = path; this.strokes = []; this.drawing = null;
        this.status.label = path ? `Saved to ${path} and copied to the clipboard.` : 'Copied to the clipboard.'; this.update();
        this.show();
    }
    setStatus(message: string) { this.status.label = message; }

    private update() {
        const has = this.pixbuf !== null;
        this.copy.sensitive = this.save.sensitive = has; this.undo.sensitive = has && this.strokes.length > 0;
        for (const tool of this.tools) tool.sensitive = has;
        this.area.queue_draw();
    }
    /** Where the image sits in the canvas: it is scaled down to fit and never scaled up. */
    private layout(): {scale: number; x: number; y: number} | null {
        if (!this.pixbuf) return null;
        const width = this.area.get_allocated_width(), height = this.area.get_allocated_height();
        const scale = Math.min(1, (width - 16) / this.pixbuf.get_width(), (height - 16) / this.pixbuf.get_height());
        return {scale, x: (width - this.pixbuf.get_width() * scale) / 2, y: (height - this.pixbuf.get_height() * scale) / 2};
    }
    private paint(cr: Cairo.Context) {
        const layout = this.layout();
        if (!layout || !this.pixbuf) return;
        cr.translate(layout.x, layout.y); cr.scale(layout.scale, layout.scale);
        Gdk.cairo_set_source_pixbuf(cr, this.pixbuf, 0, 0); cr.paint();
        drawStrokes(cr, this.drawing && !this.strokes.includes(this.drawing) ? [...this.strokes, this.drawing] : this.strokes);
    }
    private point(event: Gdk.EventButton | Gdk.EventMotion): Point | null {
        const layout = this.layout(); if (!layout) return null;
        const [, x, y] = (event as unknown as Gdk.Event).get_coords();
        return {x: (x - layout.x) / layout.scale, y: (y - layout.y) / layout.scale};
    }
    private press(event: Gdk.EventButton): boolean {
        const button = (event as unknown as Gdk.Event).get_button()[1], point = this.point(event);
        if (button !== 1 || !point || !this.pixbuf) return false;
        const width = Math.max(2, Math.round(Math.max(this.pixbuf.get_width(), this.pixbuf.get_height()) / 400));
        this.drawing = {tool: this.tool, color: this.color, width, points: [point]}; this.strokes.push(this.drawing); this.update();
        return true;
    }
    private move(event: Gdk.EventMotion): boolean {
        const point = this.point(event);
        if (!this.drawing || !point) return false;
        this.drawing.points.push(point); this.area.queue_draw();
        return true;
    }
    private async image(): Promise<GdkPixbuf.Pixbuf | null> {
        if (!this.pixbuf) return null;
        for (const stroke of this.strokes) stroke.points = thin(stroke.points, 1);
        return annotatedImage(this.pixbuf, this.strokes);
    }
    private async copyImage() {
        try {const image = await this.image(); if (!image || this.destroyed) return; copySnip(image); this.status.label = 'Copied to the clipboard.'; } catch (error) { if (this.destroyed) return; this.status.label = `Could not copy: ${String(error)}`; }
    }
    private async saveAs() {
        let image: GdkPixbuf.Pixbuf | null;
        try {image = await this.image();} catch (error) {if (!this.destroyed) this.status.label = String(error); return;} if (!image || this.destroyed) return;
        const dialog = new Gtk.FileChooserNative({title: 'Save screenshot', action: Gtk.FileChooserAction.SAVE, transient_for: this.window, accept_label: 'Save', do_overwrite_confirmation: true});
        try { dialog.set_current_folder(screenshotFolder()); } catch { /* The dialog falls back to its default folder. */ }
        dialog.set_current_name(this.path ? GLib.path_get_basename(this.path) : 'Screenshot.png');
        const filter = new Gtk.FileFilter(); filter.set_name('PNG image'); filter.add_mime_type('image/png'); dialog.add_filter(filter);
        dialog.connect('response', async (_dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                try {
                    let target = dialog.get_filename()!; if (!/\.png$/i.test(target)) target += '.png';
                    await saveImageAs(image!, target); if (this.destroyed) {dialog.destroy(); return;} this.path = target; this.status.label = `Saved to ${target}.`;
                } catch (error) { if (this.destroyed) {dialog.destroy(); return;} this.status.label = `Could not save: ${String(error)}`; }
            }
            dialog.destroy();
        });
        dialog.show();
    }
    private openFolder() {
        void openScreenshotFolder().catch(error => {if (!this.destroyed) this.status.label = String(error);});
    }
    destroy() {
        if (this.destroyed) return; this.destroyed = true;
        this.header.destroy(); this.window.destroy(); this.actions.closed();
    }
}
