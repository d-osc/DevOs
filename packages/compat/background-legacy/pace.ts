import {Gio} from '@dev-os/core';

/** Scenes with quick motion (falling code, a radar sweep, meteors) run at 15 fps; the slow ambient ones need only 10. On battery both halve. */
const quick = new Set(['matrix', 'terminal', 'circuit', 'radar', 'network', 'meteors']);
export const motionInterval = (style: string, onBattery: boolean): number => (quick.has(style) ? 67 : 100) * (onBattery ? 2 : 1);

export interface Rect {x: number; y: number; width: number; height: number}
export interface CoverWindow {minimized: boolean; maximized?: boolean; fullscreen?: boolean; desktop?: number; sticky?: boolean; geometry?: Rect}
/** True when a maximized or fullscreen window of the active desktop hides this whole monitor: nobody can see the animation, so it stops drawing. */
export function monitorCovered(windows: readonly CoverWindow[], desktops: readonly {id: number; active: boolean}[], monitor: Rect, singleMonitor: boolean): boolean {
    const active = desktops.find(desktop => desktop.active)?.id;
    return windows.some(window => {
        if (window.minimized || !(window.maximized || window.fullscreen)) return false;
        if (active !== undefined && window.desktop !== undefined && !window.sticky && window.desktop !== active) return false;
        const box = window.geometry;
        if (!box) return singleMonitor;
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        return x >= monitor.x && x < monitor.x + monitor.width && y >= monitor.y && y < monitor.y + monitor.height;
    });
}

/** The machine runs on its battery when a battery is discharging and no mains supply is online. */
export function onBatteryFrom(supplies: readonly {type: string; online?: string; status?: string}[]): boolean {
    if (supplies.some(supply => supply.type === 'Mains' && supply.online === '1')) return false;
    return supplies.some(supply => supply.type === 'Battery' && supply.status === 'Discharging');
}
const text = (path: string) => { try { const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null); return ok ? new TextDecoder().decode(bytes).trim() : undefined; } catch { return undefined; } };
export function readOnBattery(root = '/sys/class/power_supply'): boolean {
    try {
        const names: string[] = [], listing = Gio.File.new_for_path(root).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info = listing.next_file(null); info; info = listing.next_file(null)) names.push(info.get_name());
        listing.close(null);
        return onBatteryFrom(names.map(name => ({type: text(`${root}/${name}/type`) ?? '', online: text(`${root}/${name}/online`), status: text(`${root}/${name}/status`)})));
    } catch { return false; }
}
