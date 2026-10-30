import {Gdk, Gio, GLib, Gtk} from '@dev-os/core';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import {serviceClass} from '@dev-os/runtime/app-service';
import type {Point, Rect} from './geometry.js';
import type {Stroke} from './drawing.js';
export interface Frame {pixbuf: GdkPixbuf.Pixbuf; bounds: Rect; scale: number;}
const ScreenshotData = serviceClass<typeof import('./capture.backend.js').ScreenshotData>('screenshot/capture.ScreenshotData', {});
let service: InstanceType<typeof ScreenshotData> | undefined;
const backend = () => service ??= new ScreenshotData();
const images = new WeakMap<GdkPixbuf.Pixbuf, string>();
async function display(asset: {id: string; path: string}) {
    const file = Gio.File.new_for_path(asset.path);
    const stream = await new Promise<Gio.FileInputStream>((resolve, reject) => file.read_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try {resolve((source as Gio.File).read_finish(result));} catch (error) {reject(error);}
    }));
    try {
        const pixbuf = await new Promise<GdkPixbuf.Pixbuf>((resolve, reject) => GdkPixbuf.Pixbuf.new_from_stream_async(stream, null, (_source, result) => {
            try {resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));} catch (error) {reject(error);}
        }));
        images.set(pixbuf, asset.id); return pixbuf;
    } finally {stream.close(null);}
}
function imageId(pixbuf: GdkPixbuf.Pixbuf) {const id = images.get(pixbuf); if (!id) throw new Error('Image is not owned by the screenshot service.'); return id;}
export function grimAvailable() {return GLib.find_program_in_path('grim') !== null;}
export async function captureDesktop(bounds: Rect): Promise<Frame> {const asset = await backend().capture(bounds); return {pixbuf: await display(asset), bounds: asset.bounds, scale: asset.scale};}
export async function cropRectangle(frame: Frame, logical: Rect) {const asset = await backend().crop(imageId(frame.pixbuf), frame.bounds, frame.scale, logical); return asset ? display(asset) : null;}
export async function cropFreeform(frame: Frame, outline: readonly Point[]) {const asset = await backend().crop(imageId(frame.pixbuf), frame.bounds, frame.scale, [...outline]); return asset ? display(asset) : null;}
export function screenshotFolder() {const pictures = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ?? `${GLib.get_home_dir()}/Pictures`; return `${pictures}/Screenshots`;}
export async function saveSnip(pixbuf: GdkPixbuf.Pixbuf, folder?: string, date?: Date) {return backend().save(imageId(pixbuf), folder, date?.toISOString());}
export async function saveImageAs(pixbuf: GdkPixbuf.Pixbuf, path: string) {await backend().saveAs(imageId(pixbuf), path);}
export async function annotatedImage(pixbuf: GdkPixbuf.Pixbuf, strokes: Stroke[]) {return display(await backend().annotate(imageId(pixbuf), strokes));}
/** Puts the snip on the clipboard. The shell keeps running, so Wayland can serve the image to the app that pastes it. */
export function copySnip(pixbuf: GdkPixbuf.Pixbuf, display = Gdk.Display.get_default()!): void {
    const clipboard = Gtk.Clipboard.get_for_display(display, Gdk.Atom.intern('CLIPBOARD', false));
    clipboard.set_image(pixbuf);
}

export async function openScreenshotFolder() {const path = await backend().outputFolder(); Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(path).get_uri(), null);}

export async function loadImage(path: string) {return display(await backend().load(path));}
