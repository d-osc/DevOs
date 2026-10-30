export interface Point {x: number; y: number;}
export interface Rect {x: number; y: number; width: number; height: number;}
/** The capture modes of the snipping overlay. Window mode is not offered: the compositor gives clients no window geometry. */
export type SnipMode = 'rectangle' | 'freeform' | 'fullscreen';
export const SNIP_MODES: readonly {id: SnipMode; label: string; icon: string}[] = [
    {id: 'rectangle', label: 'Rectangle', icon: 'view-fullscreen-symbolic'},
    {id: 'freeform', label: 'Freeform', icon: 'document-edit-symbolic'},
    {id: 'fullscreen', label: 'Full screen', icon: 'video-display-symbolic'},
];
export const DELAYS = [0, 3, 5, 10] as const;
const MIN_SIDE = 4;

export function normalizeRect(a: Point, b: Point): Rect {
    return {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y)};
}
/** The overlap of two rectangles (zero-sized when they do not touch). */
export function intersect(a: Rect, b: Rect): Rect {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
    return {x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y)};
}
export function usable(rect: Rect): boolean { return rect.width >= MIN_SIDE && rect.height >= MIN_SIDE; }
export function pathBounds(points: readonly Point[]): Rect {
    if (!points.length) return {x: 0, y: 0, width: 0, height: 0};
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const point of points) {
        left = Math.min(left, point.x); top = Math.min(top, point.y);
        right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
    }
    return {x: left, y: top, width: right - left, height: bottom - top};
}
/** Scales a logical rectangle to image pixels, growing outwards so no edge pixel of the selection is lost. */
export function scaleRect(rect: Rect, factor: number): Rect {
    const x = Math.floor(rect.x * factor), y = Math.floor(rect.y * factor);
    return {x, y, width: Math.ceil((rect.x + rect.width) * factor) - x, height: Math.ceil((rect.y + rect.height) * factor) - y};
}
/** Pixels per logical pixel for an image that covers `logical` (grim captures at the highest output scale). */
export function imageScale(imageWidth: number, logicalWidth: number): number {
    return logicalWidth > 0 && imageWidth > 0 ? imageWidth / logicalWidth : 1;
}
/** The union of the monitor rectangles: the logical desktop that a grim capture covers. */
export function desktopBounds(monitors: readonly Rect[]): Rect {
    if (!monitors.length) return {x: 0, y: 0, width: 0, height: 0};
    const left = Math.min(...monitors.map(m => m.x)), top = Math.min(...monitors.map(m => m.y));
    const right = Math.max(...monitors.map(m => m.x + m.width)), bottom = Math.max(...monitors.map(m => m.y + m.height));
    return {x: left, y: top, width: right - left, height: bottom - top};
}
const two = (value: number) => String(value).padStart(2, '0');
export function snipFileName(date: Date): string {
    return `Screenshot ${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}.png`;
}
/** A path with a number added when the name is taken, so a snip never overwrites an earlier one. */
export function uniqueName(name: string, exists: (candidate: string) => boolean): string {
    if (!exists(name)) return name;
    const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, extension = dot > 0 ? name.slice(dot) : '';
    for (let index = 2; index < 1000; index++) if (!exists(`${stem} (${index})${extension}`)) return `${stem} (${index})${extension}`;
    throw new Error('Too many snips with the same name.');
}
/** Thins a freehand path: drops points closer than `distance` to the previous kept point (the last point is always kept). */
export function thin(points: readonly Point[], distance = 2): Point[] {
    const kept: Point[] = [];
    for (const [index, point] of points.entries()) {
        const last = kept[kept.length - 1];
        if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= distance || index === points.length - 1) kept.push(point);
    }
    return kept;
}
