import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=3.0';
import {Gio, GLib, removeTree} from '@dev-os/core/base';
import {renderAnnotated, type Stroke} from './drawing.js';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import {imageScale, intersect, pathBounds, scaleRect, snipFileName, uniqueName, usable, type Point, type Rect} from './geometry.js';

/** A frozen copy of the whole desktop and where it sits in logical (compositor) coordinates. */
export interface Frame {pixbuf: GdkPixbuf.Pixbuf; bounds: Rect; scale: number;}

export function grimAvailable(): boolean { return GLib.find_program_in_path('grim') !== null; }

/** Captures every output with grim (labwc/wlroots screencopy). Rejects with grim's own message when it fails. */
export function captureDesktop(bounds: Rect): Promise<Frame> {
    return new Promise((resolve, reject) => {
        const grim = GLib.find_program_in_path('grim');
        if (!grim) { reject(new Error('Screen capture needs grim, which is not installed on this system.')); return; }
        const path = GLib.build_filenamev([GLib.get_user_runtime_dir() || GLib.get_tmp_dir(), `dev-os-snip-${GLib.uuid_string_random().slice(0, 8)}.png`]);
        let child: Gio.Subprocess;
        // Compression level 0: the frame is read straight back, so speed matters more than size.
        try { child = Gio.Subprocess.new([grim, '-l', '0', path], Gio.SubprocessFlags.STDERR_PIPE); }
        catch (error) { reject(error instanceof Error ? error : new Error(String(error))); return; }
        child.communicate_utf8_async(null, null, (_source, result) => {
            try {
                const [, , stderr] = child.communicate_utf8_finish(result);
                if (!child.get_successful()) throw new Error(stderr?.trim() || 'grim could not capture the screen. The compositor must allow screen capture.');
                const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
                resolve({pixbuf, bounds, scale: imageScale(pixbuf.get_width(), bounds.width)});
            } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
            finally { try { Gio.File.new_for_path(path).delete(null); } catch { /* A leftover temporary file is harmless. */ } }
        });
    });
}

/** Crops a logical rectangle (relative to the desktop origin) out of a frame. */
export function cropRectangle(frame: Frame, logical: Rect): GdkPixbuf.Pixbuf | null {
    const pixels = scaleRect({x: logical.x - frame.bounds.x, y: logical.y - frame.bounds.y, width: logical.width, height: logical.height}, frame.scale);
    const rect = intersect(pixels, {x: 0, y: 0, width: frame.pixbuf.get_width(), height: frame.pixbuf.get_height()});
    return usable(rect) ? frame.pixbuf.new_subpixbuf(rect.x, rect.y, rect.width, rect.height).copy() : null;
}

/** Crops a freehand outline: pixels outside the outline become transparent. */
export function cropFreeform(frame: Frame, outline: readonly Point[]): GdkPixbuf.Pixbuf | null {
    if (outline.length < 3) return null;
    const bounds = pathBounds(outline);
    const pixels = scaleRect({x: bounds.x - frame.bounds.x, y: bounds.y - frame.bounds.y, width: bounds.width, height: bounds.height}, frame.scale);
    const rect = intersect(pixels, {x: 0, y: 0, width: frame.pixbuf.get_width(), height: frame.pixbuf.get_height()});
    if (!usable(rect)) return null;
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, rect.width, rect.height);
    const cr = new Cairo.Context(surface);
    outline.forEach((point, index) => {
        const x = (point.x - frame.bounds.x) * frame.scale - rect.x, y = (point.y - frame.bounds.y) * frame.scale - rect.y;
        if (index === 0) cr.moveTo(x, y); else cr.lineTo(x, y);
    });
    cr.closePath(); cr.clip();
    Gdk.cairo_set_source_pixbuf(cr, frame.pixbuf, -rect.x, -rect.y);
    cr.paint();
    const result = Gdk.pixbuf_get_from_surface(surface, 0, 0, rect.width, rect.height);
    cr.$dispose();
    return result;
}

export function screenshotFolder(): string {
    const pictures = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ?? GLib.build_filenamev([GLib.get_home_dir(), 'Pictures']);
    const folder = GLib.build_filenamev([pictures, 'Screenshots']);
    if (GLib.mkdir_with_parents(folder, 0o700) !== 0) throw new Error('Could not create the Screenshots folder.');
    return folder;
}
/** Saves a snip as a PNG in Pictures/Screenshots and returns its path. */
export function saveSnip(pixbuf: GdkPixbuf.Pixbuf, folder = screenshotFolder(), date = new Date()): string {
    const name = uniqueName(snipFileName(date), candidate => GLib.file_test(GLib.build_filenamev([folder, candidate]), GLib.FileTest.EXISTS));
    const path = GLib.build_filenamev([folder, name]);
    pixbuf.savev(path, 'png', [], []);
    return path;
}

export class ScreenshotData {
    private folder = GLib.dir_make_tmp('devos-screenshots-XXXXXX');
    private images = new Map<string, GdkPixbuf.Pixbuf>();
    private put(pixbuf: GdkPixbuf.Pixbuf) {
        const id = GLib.uuid_string_random(), path = `${this.folder}/${id}.png`;
        pixbuf.savev(path, 'png', [], []); this.images.set(id, pixbuf);
        return {id, path};
    }
    private image(id: string) {const image = this.images.get(id); if (!image) throw new Error('Screenshot expired. Capture another image.'); return image;}
    async load(path: string) {return this.put(GdkPixbuf.Pixbuf.new_from_file(path));}
    async outputFolder() {return screenshotFolder();}
    async capture(bounds: Rect) {const frame = await captureDesktop(bounds); return {...this.put(frame.pixbuf), bounds: frame.bounds, scale: frame.scale};}
    async crop(id: string, bounds: Rect, scale: number, shape: Rect | Point[]) {
        const frame = {pixbuf: this.image(id), bounds, scale};
        const result = Array.isArray(shape) ? cropFreeform(frame, shape) : cropRectangle(frame, shape);
        return result ? this.put(result) : null;
    }
    async annotate(id: string, strokes: Stroke[]) {return this.put(renderAnnotated(this.image(id), strokes));}
    async save(id: string, folder?: string, date?: string) {return saveSnip(this.image(id), folder, date ? new Date(date) : new Date());}
    async saveAs(id: string, path: string) {this.image(id).savev(path, 'png', [], []);}
    destroy() {this.images.clear(); removeTree(this.folder);}
}
