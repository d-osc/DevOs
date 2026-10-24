import {readJson, Gio, GLib, type Gdk} from '@dev-os/core';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import {ROOT} from '@dev-os/config';

// Font Awesome outlines extracted from assets/ by tools/maintenance/build-fa-icons.py into data/icons/fa/.
export const PACKS = ['classic', 'duotone', 'sharp', 'sharp-duotone', 'chisel', 'etch', 'graphite', 'jelly', 'mosaic', 'notdog', 'pixel', 'slab', 'thumbprint', 'utility', 'vellum', 'whiteboard'] as const;
export const STYLES = ['solid', 'regular', 'light', 'thin'] as const;
export type Pack = typeof PACKS[number];
export type Style = typeof STYLES[number];
export interface IconChoice {pack: Pack; style: Style;}
export const DEFAULT_CHOICE: IconChoice = {pack: 'duotone', style: 'solid'};
export const PACK_TITLES: Record<Pack, string> = {classic: 'Classic', duotone: 'Duotone', sharp: 'Sharp', 'sharp-duotone': 'Sharp Duotone', chisel: 'Chisel', etch: 'Etch', graphite: 'Graphite', jelly: 'Jelly', mosaic: 'Mosaic', notdog: 'Notdog', pixel: 'Pixel', slab: 'Slab', thumbprint: 'Thumbprint', utility: 'Utility', vellum: 'Vellum', whiteboard: 'Whiteboard'};

/** Styles that exist on disk for each pack. Utility and Whiteboard ship one semibold weight, offered as "solid". */
export const PACK_STYLES: Record<Pack, readonly Style[]> = {
    classic: STYLES, duotone: STYLES, sharp: STYLES, 'sharp-duotone': STYLES,
    chisel: ['regular'], etch: ['solid'], graphite: ['thin'], jelly: ['regular'], mosaic: ['solid'], notdog: ['solid'], pixel: ['regular'],
    slab: ['regular'], thumbprint: ['light'], utility: ['solid'], vellum: ['solid'], whiteboard: ['solid']
};

export const isPack = (value: unknown): value is Pack => typeof value === 'string' && (PACKS as readonly string[]).includes(value);
export const isStyle = (value: unknown): value is Style => typeof value === 'string' && (STYLES as readonly string[]).includes(value);
export const hasCombination = (pack: Pack, style: Style) => PACK_STYLES[pack].includes(style);

/** Strict parse used when saving: unknown packs or styles are rejected instead of silently replaced. */
export function parseChoice(pack: unknown, style: unknown): IconChoice {
    if (!isPack(pack)) throw new Error(`Unknown icon pack: ${String(pack)}`);
    if (!isStyle(style)) throw new Error(`Unknown icon style: ${String(style)}`);
    return {pack, style};
}
/** Lenient read of persisted values. */
export function savedChoice(pack: unknown, style: unknown): IconChoice {
    return isPack(pack) && isStyle(style) ? {pack, style} : {...DEFAULT_CHOICE};
}

export interface Glyph {w: number; d: string; d2?: string;}
export interface GlyphSet {upm: number; icons: Record<string, Glyph>;}
export interface IconData {mapping: Record<string, string>; load(pack: Pack, style: Style): GlyphSet | undefined;}

const directory = () => `${ROOT}/data/icons/fa`;
let cachedMapping: Record<string, string> | undefined;
const sets = new Map<string, GlyphSet | null>();
/** Loads glyph sets on demand; only the selected pack/style (plus fallbacks) is ever read. */
export const diskData: IconData = {
    get mapping() {
        if (!cachedMapping) {
            try {cachedMapping = (readJson(`${directory()}/index.json`) as {mapping: Record<string, string>}).mapping;}
            catch (error) {printerr(`Font Awesome icons unavailable: ${String(error)}`); cachedMapping = {};}
        }
        return cachedMapping;
    },
    load(pack, style) {
        const key = `${pack}-${style}`;
        if (!sets.has(key)) {
            try {sets.set(key, readJson(`${directory()}/${key}.json`) as GlyphSet);} catch {sets.set(key, null);}
        }
        return sets.get(key) ?? undefined;
    }
};

export const faName = (uiName: string, data: IconData = diskData): string | undefined => {
    const base = uiName.replace(/-symbolic$/, '');
    return Object.hasOwn(data.mapping, base) ? data.mapping[base] : undefined;
};

export type Fallback = 'exact' | 'same-pack' | 'classic-style' | 'classic-solid';
export interface Resolved {pack: Pack; style: Style; fa: string; glyph: Glyph; upm: number; fallback: Fallback;}

/** Weight order used to find the nearest other style inside one pack. */
const nearest = (style: Style) => [...STYLES].sort((a, b) => Math.abs(STYLES.indexOf(a) - STYLES.indexOf(style)) - Math.abs(STYLES.indexOf(b) - STYLES.indexOf(style)));

/**
 * pack+style, then the same pack in the nearest other style, then Classic in the same style, then Classic solid.
 * Returns undefined for unmapped icons or when nothing matches; callers then use the GTK icon theme, so nothing renders blank.
 */
export function resolveIcon(uiName: string, choice: IconChoice, data: IconData = diskData): Resolved | undefined {
    const fa = faName(uiName, data);
    if (!fa) return;
    const attempts: [Pack, Style, Fallback][] = [[choice.pack, choice.style, 'exact'], ...nearest(choice.style).map(style => [choice.pack, style, 'same-pack'] as [Pack, Style, Fallback]),
        ['classic', choice.style, 'classic-style'], ['classic', 'solid', 'classic-solid']];
    for (const [pack, style, fallback] of attempts) {
        if (!hasCombination(pack, style)) continue;
        const set = data.load(pack, style), glyph = set?.icons[fa];
        if (set && glyph) return {pack, style, fa, glyph, upm: set.upm, fallback};
    }
}

const hex = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');
export const cssColor = (color: {red: number; green: number; blue: number}) => `#${hex(color.red)}${hex(color.green)}${hex(color.blue)}`;

/** Square SVG with the glyph centered; duotone secondary layers use 40% opacity like Font Awesome. */
export function iconSvg(icon: Resolved, color: {red: number; green: number; blue: number; alpha?: number}): string {
    const side = Math.max(icon.glyph.w, icon.upm), offset = -(side - icon.glyph.w) / 2;
    const fill = cssColor(color), opacity = color.alpha === undefined || color.alpha >= 1 ? '' : ` opacity="${color.alpha.toFixed(2)}"`;
    const second = icon.glyph.d2 ? `<path d="${icon.glyph.d2}" fill-opacity=".4"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${offset} 0 ${side} ${side}"><g fill="${fill}"${opacity}>${second}<path d="${icon.glyph.d}"/></g></svg>`;
}

export function renderIcon(uiName: string, size: number, color: Gdk.RGBA, choice: IconChoice, data: IconData = diskData): GdkPixbuf.Pixbuf | null {
    const icon = resolveIcon(uiName, choice, data);
    if (!icon) return null;
    const bytes = new TextEncoder().encode(iconSvg(icon, color));
    return GdkPixbuf.Pixbuf.new_from_stream_at_scale(Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(bytes)), size, size, true, null);
}
