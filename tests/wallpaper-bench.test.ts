import {GLib} from '@dev-os/core';
import Cairo from 'cairo';
import {drawDesign} from '../extensions/org.devos.background/design.js';
import {motionStyles} from '../extensions/org.devos.background/motion.js';
import {motionInterval} from '../extensions/org.devos.background/pace.js';
import {wallpaperColors} from '@dev-os/core';

/** Draw cost of every animated wallpaper on the 2880x1800 OLED panel, and the processor share it needs at its real frame rate.
 *  Prints one line per style; fails only when a style would need more than half a core, which would visibly stutter the shell. */
const [width, height, frames] = [2880, 1800, Number(GLib.getenv('DEVOS_BENCH_FRAMES') ?? 30)];
const colors = wallpaperColors('dark');
const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
let worst = 0;
for (const style of motionStyles) {
    const context = new Cairo.Context(surface);
    drawDesign(context, {name: 'Dev OS', style, ...colors}, width, height, 1);
    const started = GLib.get_monotonic_time();
    for (let frame = 0; frame < frames; frame++) drawDesign(context, {name: 'Dev OS', style, ...colors}, width, height, 2 + frame * .067);
    const ms = (GLib.get_monotonic_time() - started) / 1000 / frames, interval = motionInterval(style, false), load = Math.min(100, ms / interval * 100);
    worst = Math.max(worst, load);
    print(`BENCH ${style.padEnd(10)} ${ms.toFixed(1).padStart(6)} ms/frame  every ${String(interval).padStart(3)} ms  = ${load.toFixed(0).padStart(3)}% of one core`);
    context.$dispose();
}
if (worst > 50) throw new Error(`An animated wallpaper needs ${Math.round(worst)}% of a core`);
print(`PASS: animated wallpapers stay within half a core at 2880x1800 (worst ${Math.round(worst)}%)`);
