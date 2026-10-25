import Cairo from 'cairo';
import type {MotionPalette, Rgb} from './motion.js';
import {spriteGlow} from './scene.js';

export const hackerStyles = ['matrix', 'terminal', 'circuit', 'radar', 'network'] as const;
export type HackerStyle = typeof hackerStyles[number];
const TAU = Math.PI * 2;

function sequence(seed: number): () => number {
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
/** A stable pseudo-random number for a pair of integers, so glyphs change over time without any stored state. */
function hash(a: number, b: number): number {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12;
    return ((h >>> 0) % 100000) / 100000;
}
const mix = (a: Rgb, b: Rgb, amount: number): Rgb => [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
/** Terminal green leaning toward the theme accent: bright on Dark, deep and calm on Light. */
function phosphor(p: MotionPalette): Rgb {
    return p.dark ? mix([.25, .95, .5], p.accent, .25) : mix([.04, .42, .24], p.accent, .2);
}
function glowDot(context: Cairo.Context, x: number, y: number, radius: number, color: Rgb, alpha: number) {
    spriteGlow(context, 'dot', x, y, radius, color, alpha);
}
function haze(context: Cairo.Context, x: number, y: number, radius: number, color: Rgb, alpha: number) {
    spriteGlow(context, 'haze', x, y, radius, color, alpha);
}
const glyphs = '01ABCDEF789<>/{}[]$#%=+*:;'.split('');
/** Each glyph is rendered once per size into an alpha mask; a falling column then only composites masks instead of shaping text thousands of times a frame. */
const glyphMasks = new Map<number, Cairo.ImageSurface[]>();
function masksFor(size: number): Cairo.ImageSurface[] {
    let masks = glyphMasks.get(size);
    if (masks) return masks;
    if (glyphMasks.size > 3) glyphMasks.clear();
    const cell = Math.ceil(size * 1.3);
    masks = glyphs.map(glyph => {
        const surface = new Cairo.ImageSurface(Cairo.Format.A8, cell, cell), pen = new Cairo.Context(surface);
        pen.selectFontFace('Monospace', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL); pen.setFontSize(size);
        pen.setSourceRGBA(1, 1, 1, 1); pen.moveTo(0, size); pen.showText(glyph); pen.$dispose();
        return surface;
    });
    glyphMasks.set(size, masks);
    return masks;
}
const snippets = [
    '$ ssh -i ~/.ssh/devos root@10.0.0.7', '$ nmap -sV -p 22,80,443 10.0.0.0/24', '[ ok ] handshake complete', '0x7ffd3a90  48 89 e5 48 83 ec 20 e8',
    'fn main() -> Result<()> {', '  let key = derive(&seed, 4096);', '  socket.send(&frame)?;', '  Ok(())', '}', '$ tcpdump -ni wlan0 port 443',
    '[ ..] resolving dev-os.local', 'GET /api/v1/status HTTP/1.1', '200 OK  12ms', '$ grep -rn "TODO" src/ | wc -l', 'sudo systemctl restart devos-shell',
    'const sock = new WebSocket(url);', '0x00401a2c  mov  rax, [rbp-0x18]', '0x00401a30  call 0x401b90', '[warn] retry 2/5 in 800ms', '$ cargo build --release',
    'uid=0(root) gid=0(root)', 'ECDSA key fingerprint SHA256:Qm3x', '$ git log --oneline | head', 'packets: 4096 captured, 0 dropped',
];

export function drawHacker(context: Cairo.Context, style: HackerStyle, width: number, height: number, time: number, p: MotionPalette): void {
    const {dark} = p, green = phosphor(p), reach = Math.max(width, height);
    if (style === 'matrix') {
        haze(context, width * .5, height * 1.05, reach * .6, green, dark ? .10 : .14);
        const size = Math.max(7, Math.round(height / 90)), columns = Math.ceil(width / (size * .95)), trail = 16;
        const masks = masksFor(size);
        for (let column = 0; column < columns; column++) {
            const speed = 4 + hash(column, 1) * 9, length = trail + Math.floor(hash(column, 2) * 12), span = height / size + length;
            const head = (time * speed * (.6 + hash(column, 3) * .6) + hash(column, 4) * span) % span, x = column * size * .95;
            const fade = .35 + hash(column, 5) * .65;
            for (let step = 0; step < length; step++) {
                const row = Math.floor(head) - step;
                if (row < 0 || row * size > height + size) continue;
                const age = step / length, glyph = masks[Math.floor(hash(column * 977 + row, Math.floor(time * (step ? .35 : 6) + hash(row, column) * 5)) * glyphs.length)]!;
                const alpha = (step ? (1 - age) ** 1.8 * (dark ? .42 : .34) : (dark ? .85 : .5)) * fade;
                context.setSourceRGBA(...(step ? green : mix(green, [1, 1, 1], dark ? .55 : 0)), alpha);
                context.maskSurface(glyph, x, row * size - size);
            }
        }
    } else if (style === 'terminal') {
        haze(context, width * .3, height * .4, reach * .55, green, dark ? .08 : .12);
        const size = Math.max(7, Math.round(height / 78)), lineHeight = size * 1.5;
        context.selectFontFace('Monospace', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL); context.setFontSize(size);
        const panels: [number, number, number, number][] = [[.04, .30, 22, 1], [.38, .30, 16, .8], [.72, .26, 28, .7]];
        panels.forEach(([left, span, speed, strength], panel) => {
            const rows = Math.ceil(height / lineHeight) + 2, offset = (time * speed) % lineHeight, first = Math.floor(time * speed / lineHeight);
            for (let row = -1; row < rows; row++) {
                const index = first + row, y = (rows - row) * lineHeight - offset - lineHeight, line = snippets[Math.floor(hash(index, panel * 31) * snippets.length)]!;
                const edge = Math.min(1, y / (height * .18), (height - y) / (height * .18));
                if (edge <= 0) continue;
                context.setSourceRGBA(...green, (dark ? .30 : .26) * strength * edge * (line.startsWith('$') ? 1.5 : 1));
                context.moveTo(width * left, y); context.showText(line.slice(0, Math.floor(width * span / (size * .6))));
            }
        });
        const blink = Math.floor(time * 1.6) % 2 === 0;
        context.setSourceRGBA(...green, dark ? .5 : .4);
        context.moveTo(width * .04, height * .93); context.showText('devos@live:~$');
        if (blink) { context.rectangle(width * .04 + size * 7.9, height * .93 - size * .85, size * .55, size * 1.05); context.fill(); }
    } else if (style === 'circuit') {
        haze(context, width * .65, height * .5, reach * .6, green, dark ? .09 : .13);
        const random = sequence(1337), step = Math.max(8, height / 24);
        for (let trace = 0; trace < 30; trace++) {
            let gx = Math.floor(random() * width / step), gy = Math.floor(random() * height / step);
            const points: [number, number][] = [[gx * step, gy * step]];
            let direction = Math.floor(random() * 4);
            for (let segment = 0; segment < 4; segment++) {
                const length = 3 + Math.floor(random() * 8);
                const dx = [1, 0, -1, 0][direction]!, dy = [0, 1, 0, -1][direction]!;
                gx += dx * length; gy += dy * length;
                points.push([gx * step, gy * step]);
                direction = (direction + (random() > .5 ? 1 : 3)) % 4;
            }
            const lengths = [0]; for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
            const total = lengths[lengths.length - 1]!;
            context.newPath(); points.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
            context.setLineWidth(.8); context.setSourceRGBA(...green, dark ? .13 : .16); context.stroke();
            for (const [x, y] of [points[0]!, points[points.length - 1]!]) { context.setSourceRGBA(...green, dark ? .28 : .24); context.arc(x, y, 1.6, 0, TAU); context.stroke(); }
            const pulses = 1 + (trace % 2), speed = 1 / (6 + random() * 8);
            for (let pulse = 0; pulse < pulses; pulse++) for (let tail = 0; tail < 7; tail++) {
                const along = ((((time * speed + random() + pulse / pulses) % 1) + 1) % 1) * total - tail * 2.2;
                if (along < 0 || along > total) continue;
                let seg = 1; while (seg < lengths.length - 1 && lengths[seg]! < along) seg++;
                const f = (along - lengths[seg - 1]!) / Math.max(1e-6, lengths[seg]! - lengths[seg - 1]!), a = points[seg - 1]!, b = points[seg]!;
                glowDot(context, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, tail ? 2.4 : 5, tail ? green : mix(green, [1, 1, 1], dark ? .4 : 0), (dark ? .8 : .55) * (1 - tail / 7));
            }
        }
    } else if (style === 'radar') {
        const cx = width * .7, cy = height * .5, radius = Math.min(width * .42, height * .46), sweep = (time / 7) % 1 * TAU;
        haze(context, cx, cy, radius * 1.6, green, dark ? .10 : .14);
        context.setLineWidth(.8); context.setSourceRGBA(...green, dark ? .18 : .22);
        for (let ring = 1; ring <= 4; ring++) { context.newPath(); context.arc(cx, cy, radius * ring / 4, 0, TAU); context.stroke(); }
        for (let tick = 0; tick < 12; tick++) { const angle = tick / 12 * TAU; context.moveTo(cx + Math.cos(angle) * radius * .96, cy + Math.sin(angle) * radius * .96); context.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius); }
        context.moveTo(cx - radius, cy); context.lineTo(cx + radius, cy); context.moveTo(cx, cy - radius); context.lineTo(cx, cy + radius); context.stroke();
        for (let wedge = 0; wedge < 36; wedge++) {
            const a0 = sweep - (wedge + 1) * .028, a1 = sweep - wedge * .028;
            context.newPath(); context.moveTo(cx, cy); context.arc(cx, cy, radius, a0, a1); context.closePath();
            context.setSourceRGBA(...green, (dark ? .22 : .2) * (1 - wedge / 36) ** 2); context.fill();
        }
        context.newPath(); context.moveTo(cx, cy); context.lineTo(cx + Math.cos(sweep) * radius, cy + Math.sin(sweep) * radius);
        context.setLineWidth(1); context.setSourceRGBA(...green, dark ? .55 : .45); context.stroke();
        const random = sequence(99);
        for (let blip = 0; blip < 9; blip++) {
            const angle = random() * TAU, distance = (.2 + random() * .75) * radius, since = (((sweep - angle) % TAU) + TAU) % TAU, lit = Math.max(0, 1 - since / 4.2) ** 2;
            if (lit < .02) continue;
            glowDot(context, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance, 4.5, mix(green, [1, 1, 1], dark ? .35 : 0), (dark ? .9 : .6) * lit);
        }
    } else {
        haze(context, width * .75, height * .35, reach * .6, green, dark ? .09 : .13);
        const random = sequence(4242), nodes: [number, number, number, number, number][] = [];
        for (let index = 0; index < 30; index++) nodes.push([random(), random(), random() * TAU, .01 + random() * .02, 40 + random() * 60]);
        const place = nodes.map(([x, y, phase, amount, period]) => [(x + Math.sin(time / period * TAU + phase) * amount) * width, (y + Math.cos(time / period * TAU * .9 + phase) * amount) * height] as [number, number]);
        const link = reach * .24;
        context.setLineWidth(.7);
        for (let a = 0; a < place.length; a++) for (let b = a + 1; b < place.length; b++) {
            const distance = Math.hypot(place[a]![0] - place[b]![0], place[a]![1] - place[b]![1]);
            if (distance > link) continue;
            context.setSourceRGBA(...green, (dark ? .16 : .2) * (1 - distance / link));
            context.newPath(); context.moveTo(...place[a]!); context.lineTo(...place[b]!); context.stroke();
            const seed = a * 97 + b;
            if (hash(seed, 7) < .45) {
                const f = ((time / (4 + hash(seed, 8) * 6) + hash(seed, 9)) % 1), forward = hash(seed, 10) > .5, k = forward ? f : 1 - f;
                glowDot(context, place[a]![0] + (place[b]![0] - place[a]![0]) * k, place[a]![1] + (place[b]![1] - place[a]![1]) * k, 4, mix(green, [1, 1, 1], dark ? .4 : 0), (dark ? .8 : .55) * Math.sin(f * Math.PI));
            }
        }
        place.forEach(([x, y], index) => {
            const size = 1.6 + (index % 4) * .5;
            context.setSourceRGBA(...green, dark ? .55 : .45); context.rectangle(x - size / 2, y - size / 2, size, size); context.fill();
            context.setSourceRGBA(...green, dark ? .18 : .2); context.arc(x, y, size * 2.2, 0, TAU); context.stroke();
        });
    }
}
