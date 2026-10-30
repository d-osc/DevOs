import {GLib, Gio} from '@dev-os/core';
import {motionInterval, monitorCovered, onBatteryFrom, readOnBattery} from '../packages/compat/background-legacy/pace.js';
import {motionStyles} from '../packages/compat/background-legacy/motion.js';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
// Animated wallpapers never run faster than 15 fps, slow ambient scenes at 10, and both halve on battery.
for (const style of motionStyles) {
    const ac = motionInterval(style, false), battery = motionInterval(style, true);
    assert(ac >= 66 && ac <= 100, `${style} runs at 10 to 15 fps on AC (${ac} ms)`);
    assert(battery === ac * 2, `${style} halves its frame rate on battery`);
}
assert(motionInterval('matrix', false) === 67 && motionInterval('nebula', false) === 100, 'Quick scenes get 15 fps and slow ones 10 fps');

// A maximized or fullscreen window over the monitor pauses the animation; anything else keeps it running.
const screen = {x: 0, y: 0, width: 2880, height: 1800}, second = {x: 2880, y: 0, width: 1920, height: 1080};
const desktops = [{id: 1, active: true}, {id: 2, active: false}];
const window = (patch: object) => ({minimized: false, maximized: true, desktop: 1, geometry: {x: 0, y: 40, width: 2880, height: 1760}, ...patch});
assert(monitorCovered([window({})], desktops, screen, false), 'A maximized window covers its monitor');
assert(monitorCovered([window({maximized: false, fullscreen: true})], desktops, screen, false), 'A fullscreen window covers its monitor');
assert(!monitorCovered([window({maximized: false})], desktops, screen, false), 'A normal window does not cover it');
assert(!monitorCovered([window({minimized: true})], desktops, screen, false), 'A minimized window does not cover it');
assert(!monitorCovered([window({desktop: 2})], desktops, screen, false), 'A window on another desktop does not cover it');
assert(monitorCovered([window({desktop: 2, sticky: true})], desktops, screen, false), 'A sticky window is on every desktop');
assert(!monitorCovered([window({})], desktops, second, false), 'A window on the other monitor does not cover this one');
assert(monitorCovered([window({geometry: {x: 2880, y: 40, width: 1920, height: 1040}})], desktops, second, false), 'The second monitor is covered by its own window');
assert(monitorCovered([window({geometry: undefined})], desktops, screen, true) && !monitorCovered([window({geometry: undefined})], desktops, screen, false), 'Without geometry only a single monitor is assumed covered');
assert(!monitorCovered([], desktops, screen, true), 'No windows, nothing covered');

// Power source: mains wins, then a discharging battery.
assert(!onBatteryFrom([{type: 'Mains', online: '1'}, {type: 'Battery', status: 'Discharging'}]), 'Mains online is not battery power');
assert(onBatteryFrom([{type: 'Mains', online: '0'}, {type: 'Battery', status: 'Discharging'}]), 'A discharging battery without mains is battery power');
assert(!onBatteryFrom([{type: 'Battery', status: 'Full'}]) && !onBatteryFrom([]), 'A full battery or no battery is not battery power');
const root = GLib.dir_make_tmp('devos-pace-XXXXXX');
try {
    for (const [name, files] of Object.entries({AC: {type: 'Mains', online: '0'}, BAT0: {type: 'Battery', status: 'Discharging'}})) {
        GLib.mkdir_with_parents(`${root}/${name}`, 0o755);
        for (const [file, value] of Object.entries(files)) Gio.File.new_for_path(`${root}/${name}/${file}`).replace_contents(new TextEncoder().encode(`${value}\n`), null, false, Gio.FileCreateFlags.NONE, null);
    }
    assert(readOnBattery(root), 'sysfs reading finds the discharging battery');
    Gio.File.new_for_path(`${root}/AC/online`).replace_contents(new TextEncoder().encode('1\n'), null, false, Gio.FileCreateFlags.NONE, null);
    assert(!readOnBattery(root), 'sysfs reading sees the adapter');
    assert(!readOnBattery(`${root}/missing`), 'A missing power_supply directory is not battery power');
} finally { GLib.spawn_command_line_sync(`rm -rf ${root}`); }
print('PASS: animated wallpaper pace (15/10 fps, half on battery) and pause when a window covers the monitor');
