import {GLib} from '@dev-os/core';
import Cairo from 'cairo';
import {drawDesign, isDarkBase, designStyles} from '../extensions/org.devos.background/design.js';
import {wallpaperColors} from '@dev-os/core';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
const variants = {dark: wallpaperColors('dark'), light: wallpaperColors('light')};
assert(isDarkBase(variants.dark.background) && !isDarkBase(variants.light.background), 'Dark and Light themes pick their own wallpaper variant');
let slowest = 0;
const out = GLib.getenv('DEVOS_WALLPAPER_PREVIEW');
for (const style of designStyles) for (const [name, colors] of Object.entries(variants)) for (const [width, height] of [[1920, 1200], [1366, 768], [2560, 1080], [800, 1280]] as const) {
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
    const context = new Cairo.Context(surface);
    const started = GLib.get_monotonic_time();
    drawDesign(context, {name: 'Dev OS', style: style.id, ...colors}, width, height, 37);
    const ms = (GLib.get_monotonic_time() - started) / 1000;
    slowest = Math.max(slowest, ms);
    assert(ms < 1500, `${style.id} ${name} ${width}x${height} wallpaper draws in ${Math.round(ms)} ms`);
    if (out && width === 1920) surface.writeToPNG(`${out}/wallpaper-${style.id}-${name}.png`);
    if (out && width === 800) surface.writeToPNG(`${out}/wallpaper-${style.id}-${name}-portrait.png`);
    context.$dispose();
}
print(`PASS: procedural wallpaper renders every style, Dark and Light, at several aspect ratios (slowest frame ${Math.round(slowest)} ms)`);
