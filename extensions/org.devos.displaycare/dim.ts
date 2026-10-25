/** Pure geometry and strength rules for the dimming layers, kept apart from GTK so they can be tested. */
export interface Rect {x: number; y: number; width: number; height: number;}
/** Share of light removed outside the active window in Target Mode. */
export const TARGET_DIM = 0.6;
/** Strength of the darkest edge pixel for each Adaptive Edge Brightness level (0 = off). */
export const edgeAlpha = (level: number) => [0, 0.12, 0.22, 0.34, 0.5][Math.max(0, Math.min(4, Math.round(level)))];
/** Width of the faded band, from the shorter side of the screen. */
export const edgeBand = (width: number, height: number) => Math.round(Math.min(width, height) * 0.08);
/** Adaptive Edge Brightness only runs on battery; a desktop without a battery never dims. */
export const edgeActive = (level: number, battery: {present: boolean; onBattery: boolean}) => level > 0 && battery.present && battery.onBattery;
/** Window rectangle in the coordinates of the layer surface, which fills `area` (the work area of its output). */
export function localRect(window: Rect, area: Rect): Rect {return {x: window.x - area.x, y: window.y - area.y, width: window.width, height: window.height};}
/** True when `point` lies inside `bounds` (used to match a window's work area to a monitor). */
export const contains = (bounds: Rect, x: number, y: number) => x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
/** Frame colours of the Pixel refresh screen saver: full-white and each primary on every pixel, then black. */
export const refreshColors: readonly (readonly [number, number, number])[] = [[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]];
export const REFRESH_FRAME_MS = 1500;
