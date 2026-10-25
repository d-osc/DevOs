import Cairo from 'cairo';
import type {Rgb} from './motion.js';

/** Radial falloffs as alpha-only sprites: [position, weight] stops and the sprite size in pixels. */
const falloffs = {
    glow: {size: 256, stops: [[0, 1], [.2, .8], [.4, .5], [.6, .26], [.8, .08], [1, 0]]},
    haze: {size: 256, stops: [[0, 1], [.25, .75], [.5, .4], [.75, .12], [1, 0]]},
    dot: {size: 32, stops: [[0, 1], [.35, .35], [1, 0]]},
    spark: {size: 32, stops: [[0, 1], [.3, .3636], [1, 0]]},
} as const;
export type Falloff = keyof typeof falloffs;
const sprites = new Map<Falloff, Cairo.ImageSurface>();
function sprite(kind: Falloff): Cairo.ImageSurface {
    let surface = sprites.get(kind);
    if (surface) return surface;
    const {size, stops} = falloffs[kind], half = size / 2;
    surface = new Cairo.ImageSurface(Cairo.Format.A8, size, size);
    const pen = new Cairo.Context(surface), gradient = new Cairo.RadialGradient(half, half, 0, half, half, half);
    for (const [stop, weight] of stops) gradient.addColorStopRGBA(stop, 0, 0, 0, weight);
    pen.setSource(gradient); pen.paint(); pen.$dispose();
    sprites.set(kind, surface);
    return surface;
}
/** A soft round glow of `radius` around a point. Evaluating a radial gradient for every pixel of a large glow was the main cost of the animated
 *  wallpapers; stamping a cached, scaled alpha sprite in the glow color is several times cheaper and looks the same. */
export function spriteGlow(context: Cairo.Context, kind: Falloff, x: number, y: number, radius: number, color: Rgb, alpha: number) {
    if (radius <= 0 || alpha <= 0) return;
    const mask = sprite(kind), scale = radius * 2 / falloffs[kind].size;
    context.save();
    context.translate(x - radius, y - radius); context.scale(scale, scale);
    context.setSourceRGBA(...color, alpha);
    context.maskSurface(mask, 0, 0);
    context.restore();
}
/** A black or tinted edge shade that fades in toward the corners: cached once per size as an alpha mask. */
const shades = new Map<string, Cairo.ImageSurface>();
export function paintShade(context: Cairo.Context, width: number, height: number, color: Rgb, alpha: number) {
    const key = `${width}x${height}@${alpha}`;
    let mask = shades.get(key);
    if (!mask) {
        if (shades.size > 4) shades.clear();
        mask = new Cairo.ImageSurface(Cairo.Format.A8, width, height);
        const pen = new Cairo.Context(mask), gradient = new Cairo.RadialGradient(width / 2, height / 2, Math.min(width, height) * .45, width / 2, height / 2, Math.hypot(width, height) * .62);
        gradient.addColorStopRGBA(0, 0, 0, 0, 0); gradient.addColorStopRGBA(1, 0, 0, 0, alpha);
        pen.setSource(gradient); pen.paint(); pen.$dispose();
        shades.set(key, mask);
    }
    context.setSourceRGB(...color); context.maskSurface(mask, 0, 0);
}
/** Many small discs drawn with one path per color and alpha step (1/31) instead of one fill each. */
export class DotBatch {
    private buckets = new Map<number, number[]>();
    constructor(private colors: readonly Rgb[]) {}
    add(color: number, alpha: number, x: number, y: number, radius: number) {
        const key = color * 32 + Math.max(0, Math.min(31, Math.round(alpha * 31)));
        let list = this.buckets.get(key);
        if (!list) { list = []; this.buckets.set(key, list); }
        list.push(x, y, radius);
    }
    paint(context: Cairo.Context) {
        for (const [key, list] of this.buckets) {
            context.setSourceRGBA(...this.colors[key >> 5]!, (key & 31) / 31);
            context.newPath();
            for (let index = 0; index < list.length; index += 3) { context.moveTo(list[index]! + list[index + 2]!, list[index + 1]!); context.arc(list[index]!, list[index + 1]!, list[index + 2]!, 0, Math.PI * 2); }
            context.fill();
        }
        this.buckets.clear();
    }
}
