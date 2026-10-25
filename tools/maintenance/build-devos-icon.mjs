// The Dev OS mark. data/icons/devos/devos-mark.svg is the master; this derives everything else from it:
//   devos-mark-transparent.svg    no background, the original light shapes (greeter, dark UI)
//   devos-mark-currentcolor.svg   transparent background, shapes in currentColor (docs, web, theme-aware use)
//   hicolor/scalable/apps/dev-os.svg           app icon (the master as is)
//   hicolor/scalable/apps/dev-os-symbolic.svg  monochrome, recoloured by GTK like the other symbolic icons
//   hicolor/<n>x<n>/apps/dev-os.png            rasterised app icon, for consumers that cannot read SVG
// The PNGs come from a small anti-aliased rasteriser of the same three shapes, so no SVG renderer is needed.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
const root = new URL('../../', import.meta.url);
const master = readFileSync(new URL('data/icons/devos/devos-mark.svg', root), 'utf8');
const put = (path, data) => { mkdirSync(new URL('.', new URL(path, root)), {recursive: true}); writeFileSync(new URL(path, root), data); };

const strip = svg => svg.replace(/\s*<!--[\s\S]*?-->/g, '').replace(/\s*<rect width="100" height="100"[^>]*\/>/, '');
// The shapes only fill x 22..86, y 32..72 of the master box. Variants without the dark square crop to a square around them
// (same shapes and proportions) so they fill their slot instead of floating small and off-centre.
const fitted = svg => svg.replace('viewBox="0 0 100 100"', 'viewBox="18 16 72 72"');
const shapes = fill => strip(master).replaceAll('#EAEAEA', fill);
put('data/icons/devos/devos-mark-currentcolor.svg', fitted(shapes('currentColor')).replace(' width="100%" height="100%"', ''));
put('data/icons/devos/devos-mark-transparent.svg', fitted(shapes('#EAEAEA')));
put('data/icons/hicolor/scalable/apps/dev-os.svg', master);
put('data/icons/hicolor/scalable/apps/dev-os-symbolic.svg', fitted(shapes('#2e3436')).replace(' width="100%" height="100%"', ' width="16" height="16"'));

// Geometry of the master, in its 100 x 100 space.
const shapesList = [
    {rect: [22, 32, 40, 32, 2]},
    {circle: [81, 67, 5]},
];
const inside = (x, y) => shapesList.some(s => {
    if (s.circle) return (x - s.circle[0]) ** 2 + (y - s.circle[1]) ** 2 <= s.circle[2] ** 2;
    const [rx, ry, w, h, r] = s.rect, cx = Math.min(Math.max(x, rx + r), rx + w - r), cy = Math.min(Math.max(y, ry + r), ry + h - r);
    return x >= rx && x <= rx + w && y >= ry && y <= ry + h && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
});
const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
function png(size) {
    const samples = 4, background = [0x24, 0x24, 0x24], light = [0xea, 0xea, 0xea], raw = Buffer.alloc(size * (size * 3 + 1));
    for (let y = 0; y < size; y++) {
        raw[y * (size * 3 + 1)] = 0;
        for (let x = 0; x < size; x++) {
            let hit = 0;
            for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) if (inside((x + (sx + .5) / samples) * 100 / size, (y + (sy + .5) / samples) * 100 / size)) hit++;
            const a = hit / (samples * samples);
            for (let k = 0; k < 3; k++) raw[y * (size * 3 + 1) + 1 + x * 3 + k] = Math.round(background[k] + (light[k] - background[k]) * a);
        }
    }
    const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
for (const size of sizes) put(`data/icons/hicolor/${size}x${size}/apps/dev-os.png`, png(size));
console.log(`Wrote the Dev OS mark: master variants and ${sizes.length} PNG sizes.`);
