import Cairo from 'cairo';
import {drawHacker, hackerStyles, type HackerStyle} from './hacker.js';

export type Rgb = [number, number, number];
export interface MotionPalette {dark: boolean; base: Rgb; accent: Rgb; cool: Rgb; warm: Rgb}
export const spaceStyles = ['starfield', 'nebula', 'galaxy', 'meteors', 'eclipse'] as const;
export const motionStyles = ['flow', 'ripples', 'fireflies', 'tide', 'planets', ...spaceStyles, ...hackerStyles] as const;
export type MotionStyle = typeof motionStyles[number];
export const isMotion = (style: string): style is MotionStyle => (motionStyles as readonly string[]).includes(style);
/** The animated scene is drawn at a third of the screen size and scaled up, which keeps 20 fps cheap on a high-resolution panel. */
export const MOTION_SCALE = 3;
/** Space scenes keep single stars crisp, so they are drawn at half size instead. */
export const motionScale = (style: string) => ([...spaceStyles, ...hackerStyles] as readonly string[]).includes(style) ? 2 : MOTION_SCALE;
export const MOTION_INTERVAL_MS = 50;

const TAU = Math.PI * 2;
function sequence(seed: number): () => number {
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function glow(context: Cairo.Context, x: number, y: number, radius: number, color: Rgb, alpha: number) {
    const gradient = new Cairo.RadialGradient(x, y, 0, x, y, radius);
    for (const [stop, weight] of [[0, 1], [.2, .8], [.4, .5], [.6, .26], [.8, .08], [1, 0]] as const) gradient.addColorStopRGBA(stop, ...color, alpha * weight);
    context.setSource(gradient);
    context.paint();
}
const mix = (a: Rgb, b: Rgb, amount: number): Rgb => [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
/** Stars in parallax layers: nearer ones are bigger, brighter and drift faster. On Light they become faint accent-colored specks. */
function stars(context: Cairo.Context, width: number, height: number, time: number, p: MotionPalette, count: number, seed: number, drift: number) {
    const random = sequence(seed);
    for (let index = 0; index < count; index++) {
        const x0 = random(), y0 = random(), depth = .25 + random() * .75, rate = .4 + random() * 1.4, offset = random() * TAU;
        const x = ((x0 - time * drift * depth) % 1 + 1) % 1 * width, size = .3 + depth * .75 + (random() > .97 ? .6 : 0);
        const twinkle = .65 + .35 * Math.sin(time * rate + offset);
        const color = p.dark ? mix([.92, .95, 1], index % 3 ? p.cool : p.warm, .22) : p.accent;
        context.setSourceRGBA(...color, (p.dark ? .3 + depth * .55 : .16 + depth * .3) * twinkle);
        context.arc(x, y0 * height, size, 0, TAU); context.fill();
    }
}
function vignette(context: Cairo.Context, width: number, height: number, p: MotionPalette) {
    const gradient = new Cairo.RadialGradient(width / 2, height / 2, Math.min(width, height) * .45, width / 2, height / 2, Math.hypot(width, height) * .62);
    gradient.addColorStopRGBA(0, ...p.base, 0);
    gradient.addColorStopRGBA(1, ...(p.dark ? [0, 0, 0] as Rgb : p.base), p.dark ? .42 : .22);
    context.setSource(gradient); context.paint();
}

/** Every motion is slow and periodic, so a frame depends only on `time` in seconds. */
export function drawMotion(context: Cairo.Context, style: MotionStyle, width: number, height: number, time: number, p: MotionPalette): void {
    const {dark, base, accent, cool, warm} = p, reach = Math.max(width, height);
    context.setSourceRGB(...base); context.paint();
    if ((hackerStyles as readonly string[]).includes(style)) drawHacker(context, style as HackerStyle, width, height, time, p);
    else if (style === 'flow') {
        const blobs: [Rgb, number, number, number, number, number][] = [
            [accent, .26, 70, 0, .7, .6], [cool, .22, 95, 2, .5, .55], [warm, .16, 120, 4, .6, .5], [cool, .12, 80, 1, .3, .4]];
        for (const [color, alpha, period, phase, ax, reachScale] of blobs) {
            const angle = time / period * TAU + phase;
            glow(context, width * (.5 + ax * .5 * Math.sin(angle)), height * (.5 + .45 * Math.cos(angle * 1.3 + phase)), reach * reachScale, color, dark ? alpha : alpha * 1.25);
        }
    } else if (style === 'ripples') {
        glow(context, width * .72, height * .45, reach * .6, accent, dark ? .22 : .28);
        glow(context, width * .1, height * .9, reach * .55, cool, dark ? .16 : .24);
        context.setLineWidth(.8);
        for (let ring = 0; ring < 7; ring++) {
            const phase = (time / 22 + ring / 7) % 1, fade = Math.sin(Math.min(1, phase * 6) * Math.PI / 2) * (1 - phase) ** 1.6;
            context.newPath(); context.arc(width * .72, height * .45, phase * reach * .95, 0, TAU);
            context.setSourceRGBA(...(ring % 2 ? cool : accent), (dark ? .20 : .32) * fade); context.stroke();
        }
    } else if (style === 'fireflies') {
        glow(context, width * .75, height * .25, reach * .65, accent, dark ? .20 : .27);
        glow(context, width * .1, height * .85, reach * .6, cool, dark ? .15 : .22);
        const random = sequence(31);
        for (let index = 0; index < 46; index++) {
            const x0 = random(), y0 = random(), speed = 1 / (140 + random() * 160), sway = .01 + random() * .03, rate = .2 + random() * .5, offset = random() * TAU, size = (.5 + random() * 1.6) * Math.min(width, height) / 160;
            const x = (x0 + Math.sin(time * rate + offset) * sway) * width, y = (((y0 - time * speed) % 1) + 1) % 1 * height;
            const twinkle = .45 + .55 * Math.sin(time * (.6 + rate) + offset), color = index % 3 ? accent : index % 2 ? warm : cool;
            const dot = new Cairo.RadialGradient(x, y, 0, x, y, size * 4);
            dot.addColorStopRGBA(0, ...color, .55 * twinkle); dot.addColorStopRGBA(.3, ...color, .2 * twinkle); dot.addColorStopRGBA(1, ...color, 0);
            context.setSource(dot); context.arc(x, y, size * 4, 0, TAU); context.fill();
        }
    } else if (style === 'tide') {
        glow(context, width * .78, height * .2, reach * .6, accent, dark ? .2 : .26);
        const layers: [Rgb, number, number, number, number][] = [[cool, .56, 40, 1.6, .16], [accent, .68, 55, 2.1, .2], [warm, .8, 70, 2.7, .15], [cool, .92, 90, 3.3, .22]];
        layers.forEach(([color, level, period, frequency, alpha], layer) => {
            const amplitude = height * (.035 + layer * .008);
            context.newPath(); context.moveTo(0, height);
            for (let step = 0; step <= 48; step++) {
                const x = step / 48 * width;
                context.lineTo(x, height * level + Math.sin(x / width * TAU * frequency / 2 + time / period * TAU * (layer % 2 ? -1 : 1) + layer) * amplitude + Math.sin(x / width * TAU * .7 - time / (period * 1.7) * TAU) * amplitude * .6);
            }
            context.lineTo(width, height); context.closePath();
            const fill = new Cairo.LinearGradient(0, height * (level - .1), 0, height);
            fill.addColorStopRGBA(0, ...color, dark ? alpha * .75 : alpha * 1.25); fill.addColorStopRGBA(1, ...color, 0);
            context.setSource(fill); context.fill();
        });
    } else if (style === 'starfield') {
        glow(context, width * .8, height * .2, reach * .6, p.accent, dark ? .12 : .22);
        context.save(); context.translate(width * .5, height * .5); context.rotate(-.5);
        const band = new Cairo.LinearGradient(0, -height * .3, 0, height * .3);
        band.addColorStopRGBA(0, ...cool, 0); band.addColorStopRGBA(.5, ...cool, dark ? .10 : .16); band.addColorStopRGBA(1, ...cool, 0);
        context.setSource(band); context.rectangle(-reach, -height * .3, reach * 2, height * .6); context.fill(); context.restore();
        stars(context, width, height, time, p, 320, 11, 1 / 900);
    } else if (style === 'nebula') {
        const colors = [accent, cool, warm];
        for (let cloud = 0; cloud < 7; cloud++) {
            const angle = time / (150 + cloud * 37) * TAU + cloud * 1.7;
            glow(context, width * (.5 + .38 * Math.sin(angle + cloud)), height * (.5 + .36 * Math.cos(angle * .8 + cloud * 2.1)), reach * (.32 + (cloud % 3) * .1), colors[cloud % 3]!, dark ? .17 : .24);
        }
        stars(context, width, height, time, p, 170, 5, 1 / 1500);
    } else if (style === 'galaxy') {
        const cx = width * .68, cy = height * .46, spin = time * .012, unit = Math.min(width * .55, height * 1.0);
        glow(context, cx, cy, unit * .5, accent, dark ? .30 : .36);
        glow(context, cx, cy, unit * .12, warm, dark ? .35 : .3);
        glow(context, width * .1, height * .9, reach * .5, cool, dark ? .10 : .18);
        const random = sequence(2026);
        for (let index = 0; index < 1200; index++) {
            const arm = index % 2, along = Math.pow(random(), 1.05), theta = along * 4.4 + arm * Math.PI + spin + (random() - .5) * .55 * (1 - along * .5);
            const radius = unit * (.03 + along * .55), px = Math.cos(theta) * radius, py = Math.sin(theta) * radius * .46;
            const x = cx + px * Math.cos(-.5) - py * Math.sin(-.5), y = cy + px * Math.sin(-.5) + py * Math.cos(-.5);
            const color = dark ? mix([.92, .95, 1], index % 3 ? cool : warm, .35) : accent, twinkle = .7 + .3 * Math.sin(time * (.5 + random()) + index);
            context.setSourceRGBA(...color, (dark ? .5 : .3) * (1 - along * .6) * twinkle);
            context.arc(x, y, .35 + random() * .7, 0, TAU); context.fill();
        }
        stars(context, width, height, time, p, 110, 9, 1 / 2400);
    } else if (style === 'meteors') {
        glow(context, width * .25, height * .2, reach * .55, cool, dark ? .13 : .2);
        stars(context, width, height, time, p, 260, 3, 1 / 1100);
        [[7.3, 0], [11.1, .37], [17.9, .71]].forEach(([period, shift], stream) => {
            const cycle = time / period! + shift!, phase = cycle % 1;
            if (phase > .07) return;
            const progress = phase / .07, random = sequence(Math.floor(cycle) * 7 + stream * 101 + 13);
            const sx = width * (.1 + random() * .6), sy = height * (.02 + random() * .35), angle = .45 + random() * .3, length = reach * .16, travel = reach * .3 * progress;
            const hx = sx + Math.cos(angle) * travel, hy = sy + Math.sin(angle) * travel, tx = hx - Math.cos(angle) * length, ty = hy - Math.sin(angle) * length;
            const trail = new Cairo.LinearGradient(tx, ty, hx, hy), strength = Math.sin(progress * Math.PI);
            const color: Rgb = dark ? [.92, .96, 1] : accent;
            trail.addColorStopRGBA(0, ...color, 0); trail.addColorStopRGBA(1, ...color, (dark ? .7 : .5) * strength);
            context.setSource(trail); context.setLineWidth(.9); context.setLineCap(Cairo.LineCap.ROUND);
            context.newPath(); context.moveTo(tx, ty); context.lineTo(hx, hy); context.stroke();
        });
    } else if (style === 'eclipse') {
        stars(context, width, height, time, p, 200, 17, 1 / 2600);
        const unit = Math.min(width, height), radius = unit * .27, cx = width * .72, cy = height * .56;
        const halo = new Cairo.RadialGradient(cx, cy, radius * .96, cx, cy, radius * 1.45);
        halo.addColorStopRGBA(0, ...accent, dark ? .42 : .5); halo.addColorStopRGBA(.25, ...accent, dark ? .14 : .2); halo.addColorStopRGBA(1, ...accent, 0);
        const orbit = time / 110 * TAU, moonX = cx + Math.cos(orbit) * radius * 2.1, moonY = cy - radius * .35 + Math.sin(orbit) * radius * .55, moonR = radius * .17, behind = Math.sin(orbit) < 0;
        const moon = () => {
            const body = new Cairo.RadialGradient(moonX - moonR * .4, moonY - moonR * .4, 0, moonX, moonY, moonR);
            body.addColorStopRGBA(0, ...(dark ? [.62, .68, .74] as Rgb : mix(base, [1, 1, 1], .5)), dark ? .75 : .9); body.addColorStopRGBA(1, ...(dark ? [.05, .07, .1] as Rgb : accent), dark ? .9 : .5);
            context.setSource(body); context.arc(moonX, moonY, moonR, 0, TAU); context.fill();
        };
        if (behind) moon();
        context.setSource(halo); context.arc(cx, cy, radius * 1.45, 0, TAU); context.fill();
        const planet = new Cairo.RadialGradient(cx - radius * .45, cy - radius * .5, radius * .05, cx, cy, radius);
        planet.addColorStopRGBA(0, ...(dark ? mix(accent, [1, 1, 1], .25) : mix(accent, [1, 1, 1], .55)), dark ? .6 : .85);
        planet.addColorStopRGBA(.55, ...accent, dark ? .16 : .45); planet.addColorStopRGBA(1, ...(dark ? [0, 0, 0] as Rgb : cool), dark ? .92 : .5);
        context.setSource(planet); context.arc(cx, cy, radius, 0, TAU); context.fill();
        if (!behind) moon();
    } else {
        const cx = width * .7, cy = height * .5, unit = Math.min(width * .5, height * .8);
        glow(context, cx, cy, unit * (.55 + .04 * Math.sin(time / 6)), accent, dark ? .24 : .32);
        glow(context, width * .1, height * .9, reach * .5, cool, dark ? .15 : .22);
        context.setLineWidth(.7);
        for (let ring = 0; ring < 9; ring++) {
            const tilt = -.5 + ring * .11, squash = .38 + ring * .045, radius = unit * (.28 + ring * .13);
            context.save(); context.translate(cx, cy); context.rotate(tilt); context.scale(1, squash);
            context.newPath(); context.arc(0, 0, radius, 0, TAU); context.restore();
            context.setSourceRGBA(...(ring % 3 ? cool : accent), (dark ? .09 : .17) * (1 - ring * .07)); context.stroke();
            const angle = ring * 1.9 + time * (.9 / (ring + 2)) * (ring % 2 ? -1 : 1);
            const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius * squash;
            context.setSourceRGBA(...accent, dark ? .32 : .4);
            context.arc(cx + dx * Math.cos(tilt) - dy * Math.sin(tilt), cy + dx * Math.sin(tilt) + dy * Math.cos(tilt), 1 + (ring % 3) * .5, 0, TAU); context.fill();
        }
    }
    vignette(context, width, height, p);
}
