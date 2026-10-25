import Cairo from 'cairo';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import {Gdk, GLib} from '@dev-os/core';
import type {BackgroundConfig} from './view.js';
import {drawMotion, isMotion, motionScale, type MotionPalette} from './motion.js';

type Rgb = [number, number, number];
const channels = (color: string): Rgb => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255) as Rgb;

function toHsl([r, g, b]: Rgb): Rgb {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
}
function fromHsl([h, s, l]: Rgb): Rgb {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m];
}
/** The accent turned around the color wheel, with saturation kept in a range that stays calm on a large panel. */
function shifted(accent: Rgb, degrees: number, saturation: number): Rgb {
    const [h, s, l] = toHsl(accent);
    return fromHsl([(h + degrees + 360) % 360, Math.min(s, saturation), l]);
}
export const isDarkBase = (background: string) => {
    const [r, g, b] = channels(background);
    return .2126 * r + .7152 * g + .0722 * b < .5;
};

export const designStyles = [
    {id: 'dunes', text: 'Dunes'}, {id: 'aurora', text: 'Aurora'}, {id: 'contours', text: 'Contours'}, {id: 'facets', text: 'Facets'},
    {id: 'waves', text: 'Waves'}, {id: 'bokeh', text: 'Bokeh'}, {id: 'orbits', text: 'Orbits'}, {id: 'horizon', text: 'Horizon'}, {id: 'mosaic', text: 'Mosaic'},
    {id: 'flow', text: 'Flow (animated)'}, {id: 'ripples', text: 'Ripples (animated)'}, {id: 'fireflies', text: 'Fireflies (animated)'}, {id: 'tide', text: 'Tide (animated)'}, {id: 'planets', text: 'Planets (animated)'},
    {id: 'starfield', text: 'Starfield (space)'}, {id: 'nebula', text: 'Nebula (space)'}, {id: 'galaxy', text: 'Galaxy (space)'}, {id: 'meteors', text: 'Meteors (space)'}, {id: 'eclipse', text: 'Eclipse (space)'},
    {id: 'matrix', text: 'Matrix (hacker)'}, {id: 'terminal', text: 'Terminal (hacker)'}, {id: 'circuit', text: 'Circuit (hacker)'}, {id: 'radar', text: 'Radar (hacker)'}, {id: 'network', text: 'Network (hacker)'},
] as const;
export type DesignStyle = typeof designStyles[number]['id'];
export const designStyle = (value: unknown): DesignStyle => designStyles.find(style => style.id === value)?.id ?? 'dunes';

/** Small deterministic generator so every monitor and every redraw shows the identical pattern. */
function sequence(seed: number): () => number {
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
/** Wide, overlapping ribbons of light sweeping from the lower left to the upper right. */
function aurora(context: Cairo.Context, width: number, height: number, dark: boolean, colors: Rgb[]): void {
    colors.forEach((color, index) => {
        for (let layer = 0; layer < 5; layer++) {
            const offset = (index * 0.17 + layer * 0.035) * height, lift = height * (.22 + index * .05);
            context.newPath();
            context.moveTo(-width * .05, height * (.92 - index * .1) - offset * .2);
            context.curveTo(width * .30, height * (.35 + index * .12) + offset, width * .55, height * (1.05 - index * .1) - lift, width * 1.05, height * (.12 + index * .14) + offset * .3);
            context.setSourceRGBA(...color, (dark ? .05 : .08) * (1 - layer * .15));
            context.setLineWidth(height * (.30 - layer * .045));
            context.setLineCap(Cairo.LineCap.ROUND);
            context.stroke();
        }
    });
}
/** Thin topographic rings around an off-center peak. */
function contours(context: Cairo.Context, width: number, height: number, dark: boolean, accent: Rgb, cool: Rgb): void {
    const cx = width * .74, cy = height * .42, radius = Math.max(width, height) * .75, rings = 26;
    context.setLineWidth(1.1);
    for (let ring = 1; ring <= rings; ring++) {
        const r = radius * ring / rings;
        context.newPath();
        for (let step = 0; step <= 120; step++) {
            const angle = step / 120 * Math.PI * 2;
            const wobble = 1 + .07 * Math.sin(angle * 3 + ring * .22) + .04 * Math.sin(angle * 5 - ring * .31) + .03 * Math.sin(angle * 2 + ring * .1);
            const x = cx + Math.cos(angle) * r * wobble * 1.25, y = cy + Math.sin(angle) * r * wobble * .85;
            if (step) context.lineTo(x, y); else context.moveTo(x, y);
        }
        context.closePath();
        context.setSourceRGBA(...(ring % 5 ? cool : accent), (dark ? .09 : .16) * (ring % 5 ? .6 : 1.2) * (1 - ring / (rings * 1.4)));
        context.stroke();
    }
}
/** A low-poly mesh of translucent triangles that brightens toward the upper right. */
function facets(context: Cairo.Context, width: number, height: number, dark: boolean, colors: Rgb[]): void {
    const random = sequence(2026), columns = 12, rows = 8;
    const points: [number, number][][] = [];
    for (let row = 0; row <= rows; row++) {
        points.push([]);
        for (let column = 0; column <= columns; column++) {
            const edge = row === 0 || row === rows || column === 0 || column === columns;
            points[row]!.push([(column + (edge ? 0 : random() - .5) * .8) / columns * width * 1.02 - width * .01,
                (row + (edge ? 0 : random() - .5) * .8) / rows * height * 1.02 - height * .01]);
        }
    }
    const triangle = (a: [number, number], b: [number, number], c: [number, number]) => {
        const x = (a[0] + b[0] + c[0]) / 3 / width, y = (a[1] + b[1] + c[1]) / 3 / height;
        const glow = Math.max(0, 1 - Math.hypot(x - .8, (y - .25) * 1.2) * 1.15);
        const color = colors[Math.floor(random() * colors.length)]!;
        context.newPath(); context.moveTo(...a); context.lineTo(...b); context.lineTo(...c); context.closePath();
        context.setSourceRGBA(...color, ((dark ? .03 : .06) + random() * (dark ? .05 : .09)) * (.5 + glow * 1.5));
        context.fillPreserve();
        context.setSourceRGBA(...color, dark ? .035 : .12); context.setLineWidth(.8); context.stroke();
    };
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const a = points[row]![column]!, b = points[row]![column + 1]!, c = points[row + 1]![column]!, d = points[row + 1]![column + 1]!;
        if ((row + column) % 2) { triangle(a, b, c); triangle(b, d, c); } else { triangle(a, b, d); triangle(a, d, c); }
    }
}

/** Stacked hairline sine waves that fan out across the lower half. */
function waves(context: Cairo.Context, width: number, height: number, dark: boolean, colors: Rgb[]): void {
    const lines = 34;
    context.setLineWidth(1.2);
    for (let line = 0; line < lines; line++) {
        const t = line / (lines - 1), base = height * (.38 + t * .5), amplitude = height * (.03 + t * .07);
        context.newPath();
        for (let step = 0; step <= 160; step++) {
            const x = step / 160 * width, phase = x / width * Math.PI * 2;
            const y = base + Math.sin(phase * 1.1 + t * 2.6) * amplitude + Math.sin(phase * 2.3 - t * 4) * amplitude * .35;
            if (step) context.lineTo(x, y); else context.moveTo(x, y);
        }
        context.setSourceRGBA(...colors[line % colors.length]!, (dark ? .08 : .17) * (.35 + t));
        context.stroke();
    }
}
/** Large defocused discs of light, like a city seen through glass. */
function bokeh(context: Cairo.Context, width: number, height: number, dark: boolean, colors: Rgb[]): void {
    const random = sequence(77), unit = Math.min(width, height);
    for (let index = 0; index < 22; index++) {
        const x = random() * width, y = random() * height, r = unit * (.04 + random() * .12), color = colors[index % colors.length]!;
        const alpha = (dark ? .05 : .10) + random() * (dark ? .05 : .08);
        const disc = new Cairo.RadialGradient(x, y, r * .6, x, y, r);
        disc.addColorStopRGBA(0, ...color, alpha * .7); disc.addColorStopRGBA(.85, ...color, alpha); disc.addColorStopRGBA(1, ...color, 0);
        context.setSource(disc); context.arc(x, y, r, 0, Math.PI * 2); context.fill();
    }
}
/** Tilted elliptical orbits around a faint core, evoking a system diagram without any labels. */
function orbits(context: Cairo.Context, width: number, height: number, dark: boolean, accent: Rgb, cool: Rgb): void {
    const cx = width * .70, cy = height * .50, unit = Math.min(width * .5, height * .8);
    const core = new Cairo.RadialGradient(cx, cy, 0, cx, cy, unit * .35);
    core.addColorStopRGBA(0, ...accent, dark ? .22 : .30); core.addColorStopRGBA(1, ...accent, 0);
    context.setSource(core); context.paint();
    context.setLineWidth(1.1);
    for (let ring = 0; ring < 9; ring++) {
        context.save(); context.translate(cx, cy); context.rotate(-.5 + ring * .11); context.scale(1, .38 + ring * .045);
        context.newPath(); context.arc(0, 0, unit * (.28 + ring * .13), 0, Math.PI * 2);
        context.restore();
        context.setSourceRGBA(...(ring % 3 ? cool : accent), (dark ? .09 : .17) * (1 - ring * .07)); context.stroke();
        const angle = ring * 1.9, r = unit * (.28 + ring * .13), tilt = -.5 + ring * .11, k = .38 + ring * .045;
        const dx = Math.cos(angle) * r, dy = Math.sin(angle) * r * k;
        const px = cx + dx * Math.cos(tilt) - dy * Math.sin(tilt), py = cy + dx * Math.sin(tilt) + dy * Math.cos(tilt);
        context.setSourceRGBA(...accent, dark ? .30 : .38); context.arc(px, py, 3 + (ring % 3), 0, Math.PI * 2); context.fill();
    }
}
/** A faint perspective floor under a glowing horizon. */
function horizon(context: Cairo.Context, width: number, height: number, dark: boolean, accent: Rgb, cool: Rgb): void {
    const y0 = height * .62;
    const sun = new Cairo.RadialGradient(width * .5, y0, 0, width * .5, y0, width * .5);
    sun.addColorStopRGBA(0, ...accent, dark ? .28 : .34); sun.addColorStopRGBA(.5, ...cool, dark ? .08 : .14); sun.addColorStopRGBA(1, ...cool, 0);
    context.save(); context.rectangle(0, 0, width, y0); context.clip(); context.setSource(sun); context.paint(); context.restore();
    context.setLineWidth(1);
    const floor = new Cairo.LinearGradient(0, y0, 0, height);
    floor.addColorStopRGBA(0, ...accent, 0); floor.addColorStopRGBA(1, ...accent, dark ? .16 : .26);
    context.setSource(floor);
    for (let line = -16; line <= 16; line++) { context.moveTo(width * .5 + line * width * .012, y0); context.lineTo(width * .5 + line * width * .12, height); }
    for (let row = 1; row <= 12; row++) { const y = y0 + (height - y0) * (row / 12) ** 2; context.moveTo(0, y); context.lineTo(width, y); }
    context.stroke();
    context.setSourceRGBA(...accent, dark ? .14 : .25); context.moveTo(0, y0); context.lineTo(width, y0); context.stroke();
}
/** A grid of rounded tiles whose tint fades from the upper right. */
function mosaic(context: Cairo.Context, width: number, height: number, dark: boolean, colors: Rgb[]): void {
    const random = sequence(404), size = Math.max(width, height) / 24, gap = size * .12, radius = size * .18;
    for (let row = 0; row * size < height + size; row++) for (let column = 0; column * size < width + size; column++) {
        const x = column * size + gap / 2, y = row * size + gap / 2, w = size - gap, glow = Math.max(0, 1 - Math.hypot(column * size / width - .85, row * size / height - .1) * 1.1);
        if (random() < .35) continue;
        context.newPath();
        context.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0); context.arc(x + w - radius, y + w - radius, radius, 0, Math.PI / 2);
        context.arc(x + radius, y + w - radius, radius, Math.PI / 2, Math.PI); context.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
        context.closePath();
        context.setSourceRGBA(...colors[Math.floor(random() * colors.length)]!, ((dark ? .025 : .05) + random() * (dark ? .05 : .08)) * (.4 + glow * 1.8));
        context.fill();
    }
}

let grain: GdkPixbuf.Pixbuf | null | undefined;
/** A small tile of faint monochrome noise. Laid over the gradients it breaks up 8-bit banding without visible texture. */
function grainTile(): GdkPixbuf.Pixbuf | null {
    if (grain !== undefined) return grain;
    try {
        const size = 128, bytes = new Uint8Array(size * size * 4);
        let seed = 0x9e3779b1;
        for (let index = 0; index < size * size; index++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const light = seed >>> 31;
            bytes.set([light ? 255 : 0, light ? 255 : 0, light ? 255 : 0, 3 + ((seed >>> 8) & 3)], index * 4);
        }
        grain = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(bytes), GdkPixbuf.Colorspace.RGB, true, 8, size, size, size * 4);
    } catch { grain = null; }
    return grain;
}

/** Dither grain, drawn at full resolution over either kind of scene. There is deliberately no logo: the panel would cover it. */
function finish(context: Cairo.Context): void {
    const tile = grainTile();
    if (tile) {
        context.save();
        Gdk.cairo_set_source_pixbuf(context, tile, 0, 0);
        try { (context.getSource() as Cairo.SurfacePattern).setExtend(Cairo.Extend.REPEAT); context.paint(); } catch { /* Banding dither is optional. */ }
        context.restore();
    }
}

/** Layered mesh gradient: soft accent glows, two flowing dunes, a vignette and grain. Everything scales with the canvas, so any aspect ratio crops gracefully. */
function drawStatic(context: Cairo.Context, config: BackgroundConfig, width: number, height: number): void {
    const dark = isDarkBase(config.background);
    const base = channels(config.background), accent = channels(config.accent);
    const warm = shifted(accent, 48, .75), cool = shifted(accent, -52, .75);
    context.setSourceRGB(...base);
    context.paint();
    // Mesh: overlapping radial glows. Dark stays low so most pixels remain near black; light stays pastel.
    const blobs: [number, number, number, Rgb, number][] = dark
        ? [[.78, .24, .62, accent, .26], [.12, .82, .58, cool, .20], [.55, 1.02, .50, warm, .13], [.05, .05, .42, cool, .09]]
        : [[.78, .24, .66, accent, .30], [.10, .86, .60, cool, .26], [.58, 1.04, .52, warm, .20], [.04, .04, .46, warm, .16]];
    for (const [x, y, reach, color, alpha] of blobs) {
        const glow = new Cairo.RadialGradient(width * x, height * y, 0, width * x, height * y, Math.max(width, height) * reach);
        glow.addColorStopRGBA(0, ...color, alpha);
        for (const [stop, weight] of [[.2, .8], [.4, .5], [.6, .26], [.8, .08]]) glow.addColorStopRGBA(stop, ...color, alpha * weight);
        glow.addColorStopRGBA(1, ...color, 0);
        context.setSource(glow);
        context.paint();
    }
    const style = designStyle(config.style);
    // Dunes: two translucent hills give depth without any hard high-contrast edge.
    if (style === 'dunes') {
    const dune = (y: number, lift: number, color: Rgb, alpha: number, highlight: number) => {
        context.newPath();
        context.moveTo(0, height * y);
        context.curveTo(width * .28, height * (y - lift), width * .56, height * (y + lift * .9), width, height * (y - lift * .35));
        const top = {x: 0, y: height * (y - lift)};
        context.lineTo(width, height); context.lineTo(0, height); context.closePath();
        const fill = new Cairo.LinearGradient(0, top.y, 0, height);
        fill.addColorStopRGBA(0, ...color, alpha);
        fill.addColorStopRGBA(1, ...color, 0);
        context.setSource(fill); context.fillPreserve();
        context.setSourceRGBA(...(dark ? accent : [1, 1, 1] as Rgb), highlight);
        context.setLineWidth(1.2); context.newPath();
        context.moveTo(0, height * y);
        context.curveTo(width * .28, height * (y - lift), width * .56, height * (y + lift * .9), width, height * (y - lift * .35));
        context.stroke();
    };
    dune(.68, .16, cool, dark ? .16 : .24, dark ? .06 : .35);
    dune(.82, .12, accent, dark ? .12 : .20, dark ? .05 : .30);
    } else if (style === 'aurora') aurora(context, width, height, dark, [accent, cool, warm]);
    else if (style === 'contours') contours(context, width, height, dark, accent, cool);
    else if (style === 'facets') facets(context, width, height, dark, [accent, cool, warm]);
    else if (style === 'waves') waves(context, width, height, dark, [accent, cool, warm]);
    else if (style === 'bokeh') bokeh(context, width, height, dark, [accent, cool, warm]);
    else if (style === 'orbits') orbits(context, width, height, dark, accent, cool);
    else if (style === 'horizon') horizon(context, width, height, dark, accent, cool);
    else mosaic(context, width, height, dark, [accent, cool, warm]);
    // Vignette keeps the corners calm behind the panel and icons.
    const vignette = new Cairo.RadialGradient(width / 2, height / 2, Math.min(width, height) * .45, width / 2, height / 2, Math.hypot(width, height) * .62);
    vignette.addColorStopRGBA(0, ...base, 0);
    vignette.addColorStopRGBA(1, ...(dark ? [0, 0, 0] as Rgb : base), dark ? .42 : .22);
    context.setSource(vignette); context.paint();
    finish(context);
}

/** `time` (seconds) only matters for animated styles; it defaults to the monotonic clock. */
export function drawDesign(context: Cairo.Context, config: BackgroundConfig, width: number, height: number, time = GLib.get_monotonic_time() / 1e6): void {
    const style = designStyle(config.style);
    if (!isMotion(style)) { drawStatic(context, config, width, height); return; }
    const dark = isDarkBase(config.background), accent = channels(config.accent);
    const palette: MotionPalette = {dark, base: channels(config.background), accent, cool: shifted(accent, -52, .75), warm: shifted(accent, 48, .75)};
    const lowWidth = Math.max(2, Math.ceil(width / motionScale(style))), lowHeight = Math.max(2, Math.ceil(height / motionScale(style)));
    const key = `${lowWidth}x${lowHeight}`;
    let surface = scenes.get(key);
    if (!surface) {
        if (scenes.size > 4) scenes.clear();
        // Keep ARGB32 like the window surface: scaling an RGB24 source onto an ARGB32 target falls off pixman's fast path (4x slower).
        surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, lowWidth, lowHeight); scenes.set(key, surface);
    }
    const scene = new Cairo.Context(surface);
    drawMotion(scene, style, lowWidth, lowHeight, time, palette);
    // The dither grain goes onto the small scene: laying it over every pixel of the panel costs a second full-screen pass per frame.
    finish(scene);
    scene.$dispose();
    context.save();
    context.scale(width / lowWidth, height / lowHeight);
    context.setSourceSurface(surface, 0, 0);
    try { (context.getSource() as Cairo.SurfacePattern).setExtend(Cairo.Extend.PAD); } catch { /* Edges stay transparent. */ }
    context.paint();
    context.restore();
}
const scenes = new Map<string, Cairo.ImageSurface>();
