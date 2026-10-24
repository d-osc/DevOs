import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import {Gtk, Gdk} from './native.js';

/** Renders a symbolic icon name as a pixbuf in the given foreground color, or returns null to use the GTK icon theme. */
export type BaseIconProvider = (name: string, size: number, color: Gdk.RGBA) => GdkPixbuf.Pixbuf | null;

interface Tracked {name: string; iconSize: Gtk.IconSize; key: string; handlers: number[];}
// Weak: no destroy callback may run during garbage collection. The renderer releases images it destroys.
const tracked = new WeakMap<Gtk.Image, Tracked>();
const live = new Set<WeakRef<Gtk.Image>>();
let provider: BaseIconProvider | undefined;
const isBase = (name: string) => name.endsWith('-symbolic');

function pixelSize(image: Gtk.Image, iconSize: Gtk.IconSize): number {
    if (image.pixel_size > 0) return image.pixel_size;
    const [ok, width] = Gtk.icon_size_lookup(iconSize);
    return ok && width > 0 ? width : 16;
}
function paint(image: Gtk.Image, item: Tracked, force = false): void {
    const context = image.get_style_context();
    const color = context.get_color(context.get_state());
    const size = pixelSize(image, item.iconSize);
    const key = `${item.name}|${size}|${color.to_string()}`;
    if (!force && key === item.key) return;
    item.key = key;
    let pixbuf: GdkPixbuf.Pixbuf | null = null;
    try {pixbuf = provider?.(item.name, size, color) ?? null;} catch (error) {printerr(`Base icon ${item.name}: ${String(error)}`);}
    if (pixbuf) image.set_from_pixbuf(pixbuf);
    else image.set_from_icon_name(item.name, item.iconSize);
}
export function releaseImageIcon(image: Gtk.Image): void {
    const item = tracked.get(image);
    if (!item) return;
    for (const id of item.handlers) try {image.disconnect(id);} catch {/* destroyed */}
    tracked.delete(image);
}

/** Show `name` on the image through the base icon provider (symbolic names only); plain theme lookup otherwise. */
export function setImageIcon(image: Gtk.Image, name: string, iconSize: Gtk.IconSize = Gtk.IconSize.BUTTON): void {
    if (!isBase(name)) {releaseImageIcon(image); image.set_from_icon_name(name, iconSize); return;}
    let item = tracked.get(image);
    if (!item) {
        item = {name, iconSize, key: '', handlers: []};
        const current = item;
        const repaint = () => paint(image, current);
        current.handlers.push(image.connect('style-updated', repaint), image.connect('state-flags-changed', repaint),
            image.connect('notify::pixel-size', repaint));
        live.add(new WeakRef(image));
        tracked.set(image, item);
    }
    item.name = name; item.iconSize = iconSize;
    paint(image, item, true);
}

/** Install (or remove) the provider and repaint every base icon that is already on screen. */
export function setBaseIconProvider(next: BaseIconProvider | undefined): void {
    provider = next;
    for (const ref of [...live]) {
        const image = ref.deref(), item = image && tracked.get(image);
        if (!image || !item) {live.delete(ref); continue;}
        try {paint(image, item, true);} catch {tracked.delete(image); live.delete(ref);}
    }
}

/** Release every tracked image below a widget that is about to be destroyed. */
export function releaseImageIcons(widget: Gtk.Widget): void {
    if (widget instanceof Gtk.Image) releaseImageIcon(widget);
    if (widget instanceof Gtk.Container) widget.get_children().forEach(releaseImageIcons);
}

/** A new Gtk.Image of the given pixel size showing a base icon. */
export function baseImage(name: string, pixelSize: number): Gtk.Image {
    const image = new Gtk.Image({pixel_size: pixelSize});
    setImageIcon(image, name);
    return image;
}
