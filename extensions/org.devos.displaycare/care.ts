import {Gio, GLib} from '@dev-os/core';
export type Splendid = 'normal' | 'vivid' | 'manual' | 'eyecare';
/** Saved by `dev-os-display-care`; the shell reads the same file for the effects it draws itself. */
export interface CareSettings {
    splendid: Splendid; temperature: number; eyeCare: number; gamut: 'native'; dimming: number;
    pixelRefresh: boolean; autoHidePanel: boolean; panelTransparency: boolean; targetMode: boolean; edgeBrightness: number;
}
export const defaultCare: CareSettings = {splendid: 'normal', temperature: 0, eyeCare: 3, gamut: 'native', dimming: 100, pixelRefresh: true, autoHidePanel: false, panelTransparency: true, targetMode: false, edgeBrightness: 0};
const integer = (value: unknown, low: number, high: number, fallback: number) => typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high ? value : fallback;
const flag = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
/** Every value is checked on its own, so a damaged or hand-edited file only loses the values that are wrong. */
export function parseCare(text: string): CareSettings {
    let saved: Record<string, unknown> = {};
    try {const value: unknown = JSON.parse(text); if (value && typeof value === 'object' && !Array.isArray(value)) saved = value as Record<string, unknown>;} catch {/* defaults */}
    const d = defaultCare;
    return {
        splendid: saved.splendid === 'vivid' || saved.splendid === 'manual' || saved.splendid === 'eyecare' ? saved.splendid : 'normal',
        temperature: integer(saved.temperature, -50, 50, d.temperature), eyeCare: integer(saved.eyeCare, 1, 5, d.eyeCare), gamut: 'native', dimming: integer(saved.dimming, 0, 100, d.dimming),
        pixelRefresh: flag(saved.pixelRefresh, d.pixelRefresh), autoHidePanel: flag(saved.autoHidePanel, d.autoHidePanel), panelTransparency: flag(saved.panelTransparency, d.panelTransparency),
        targetMode: flag(saved.targetMode, d.targetMode), edgeBrightness: integer(saved.edgeBrightness, 0, 4, d.edgeBrightness),
    };
}
export const carePath = () => `${GLib.get_user_config_dir()}/devos/display-care.json`;
/** Raised by `dev-os-display-care serve` after 30 idle minutes and removed on the next input. */
export const pixelRefreshPath = () => `${GLib.getenv('XDG_RUNTIME_DIR') || '/tmp'}/devos-pixel-refresh`;
export function readCare(path = carePath()): CareSettings {
    try {const [ok, bytes] = GLib.file_get_contents(path); return ok ? parseCare(new TextDecoder().decode(bytes)) : defaultCare;} catch {return defaultCare;}
}
/** Calls `listener` when the file at `path` is created, replaced or removed (the helper replaces it atomically). */
export function watchFile(path: string, listener: () => void): () => void {
    const directory = GLib.path_get_dirname(path), name = GLib.path_get_basename(path);
    GLib.mkdir_with_parents(directory, 0o700);
    let monitor: Gio.FileMonitor;
    try {monitor = Gio.File.new_for_path(directory).monitor_directory(Gio.FileMonitorFlags.NONE, null);} catch {return () => {};}
    const id = monitor.connect('changed', (_monitor, file) => {if (file.get_basename() === name) listener();});
    return () => {monitor.disconnect(id); monitor.cancel();};
}
export const watchCare = (listener: (settings: CareSettings) => void) => watchFile(carePath(), () => listener(readCare()));
