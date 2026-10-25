import {Gtk, Gio, GLib, readText} from '@dev-os/core';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import {ROOT} from '@dev-os/config';
import {cropFreeform, cropRectangle, saveSnip, type Frame} from '../extensions/org.devos.screenshot/capture.js';
import {
    SNIP_MODES, desktopBounds, imageScale, intersect, normalizeRect, pathBounds, scaleRect, snipFileName, thin, uniqueName, usable
} from '../extensions/org.devos.screenshot/geometry.js';
import {PALETTE, drawStrokes, renderAnnotated, type Stroke} from '../extensions/org.devos.screenshot/editor.js';

Gtk.init(null);
let passed = 0;
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function same(actual: unknown, expected: unknown, message: string): void { assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
function test(name: string, callback: () => void): void { callback(); passed++; print(`PASS: screenshot ${name}`); }

/** A 100x60 frame whose left half is red, right half blue (fully opaque), covering a desktop that starts at x=10, y=20. */
function frame(scale = 1): Frame {
    const width = 100 * scale, height = 60 * scale;
    const stride = width * 4, bytes = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = y * stride + x * 4, left = x < width / 2;
        bytes[offset] = left ? 255 : 0; bytes[offset + 1] = 0; bytes[offset + 2] = left ? 0 : 255; bytes[offset + 3] = 255;
    }
    return {pixbuf: GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(bytes), GdkPixbuf.Colorspace.RGB, true, 8, width, height, stride), bounds: {x: 10, y: 20, width: 100, height: 60}, scale};
}
function pixel(pixbuf: GdkPixbuf.Pixbuf, x: number, y: number): number[] {
    const bytes = pixbuf.get_pixels(), offset = y * pixbuf.get_rowstride() + x * pixbuf.get_n_channels();
    return [bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, pixbuf.get_has_alpha() ? bytes[offset + 3]! : 255];
}

test('geometry normalises, clamps and scales', () => {
    same(normalizeRect({x: 30, y: 40}, {x: 10, y: 5}), {x: 10, y: 5, width: 20, height: 35}, 'Drag in any direction gives the same rectangle');
    same(intersect({x: 0, y: 0, width: 50, height: 50}, {x: 40, y: 40, width: 50, height: 50}), {x: 40, y: 40, width: 10, height: 10}, 'Overlap');
    same(intersect({x: 0, y: 0, width: 10, height: 10}, {x: 20, y: 20, width: 5, height: 5}).width, 0, 'No overlap is empty');
    assert(!usable({x: 0, y: 0, width: 3, height: 40}) && usable({x: 0, y: 0, width: 4, height: 4}), 'A click or tiny drag is not a snip');
    same(pathBounds([{x: 5, y: 9}, {x: 20, y: 2}, {x: 11, y: 30}]), {x: 5, y: 2, width: 15, height: 28}, 'Path bounds');
    same(scaleRect({x: 1.5, y: 2.5, width: 3, height: 3}, 2), {x: 3, y: 5, width: 6, height: 6}, 'Scaling keeps every selected pixel');
    same(scaleRect({x: 0.2, y: 0.2, width: 1, height: 1}, 1.5), {x: 0, y: 0, width: 2, height: 2}, 'Rounds outwards');
    assert(imageScale(2880, 1440) === 2 && imageScale(100, 0) === 1, 'Image scale from the desktop width');
    same(desktopBounds([{x: 0, y: 0, width: 1920, height: 1080}, {x: 1920, y: -100, width: 1280, height: 1024}]), {x: 0, y: -100, width: 3200, height: 1180}, 'Two monitors');
    same(thin([{x: 0, y: 0}, {x: 0.5, y: 0}, {x: 5, y: 0}, {x: 5.2, y: 0}], 2), [{x: 0, y: 0}, {x: 5, y: 0}, {x: 5.2, y: 0}], 'Thinning keeps the last point');
    same(SNIP_MODES.map(mode => mode.id), ['rectangle', 'freeform', 'fullscreen'], 'Window mode is not offered (no window geometry from the compositor)');
});

test('file names are readable and never overwrite', () => {
    assert(snipFileName(new Date(2026, 9, 6, 7, 8, 9)) === 'Screenshot 2026-10-06 07-08-09.png', 'Local time with zero padding');
    const taken = new Set(['a.png', 'a (2).png']);
    assert(uniqueName('b.png', name => taken.has(name)) === 'b.png', 'Free name is kept');
    assert(uniqueName('a.png', name => taken.has(name)) === 'a (3).png', 'Taken names get the next number');
});

test('rectangle crop uses the right pixels (also on a scaled capture)', () => {
    for (const scale of [1, 2]) {
        const source = frame(scale);
        const red = cropRectangle(source, {x: 10 + 5, y: 20 + 5, width: 20, height: 10})!;
        assert(red.get_width() === 20 * scale && red.get_height() === 10 * scale, `Crop size at scale ${scale}`);
        same(pixel(red, 0, 0), [255, 0, 0, 255], 'Left half is red');
        const blue = cropRectangle(source, {x: 10 + 60, y: 20, width: 30, height: 30})!;
        same(pixel(blue, 1, 1), [0, 0, 255, 255], 'Right half is blue');
        const clipped = cropRectangle(source, {x: 10 + 90, y: 20 + 50, width: 50, height: 50})!;
        assert(clipped.get_width() === 10 * scale && clipped.get_height() === 10 * scale, 'A selection past the desktop edge is clipped');
        assert(cropRectangle(source, {x: 500, y: 500, width: 20, height: 20}) === null, 'A selection outside the desktop is rejected');
    }
});

test('freeform crop makes the outside transparent', () => {
    const result = cropFreeform(frame(), [{x: 10 + 10, y: 20 + 10}, {x: 10 + 50, y: 20 + 10}, {x: 10 + 10, y: 20 + 50}])!;
    assert(result.get_width() >= 40 && result.get_height() >= 40, 'Bounding box of the outline');
    assert(pixel(result, 2, 2)[3] === 255, 'Inside the triangle is opaque');
    assert(pixel(result, result.get_width() - 2, result.get_height() - 2)[3] === 0, 'The corner outside the triangle is transparent');
    assert(cropFreeform(frame(), [{x: 1, y: 1}, {x: 2, y: 2}]) === null, 'Fewer than three points is not an outline');
});

test('saving writes a PNG and keeps earlier snips', () => {
    const folder = GLib.dir_make_tmp('dev-os-snip-XXXXXX');
    const crop = cropRectangle(frame(), {x: 10, y: 20, width: 20, height: 20})!;
    const when = new Date(2026, 0, 2, 3, 4, 5);
    const first = saveSnip(crop, folder, when), second = saveSnip(crop, folder, when);
    assert(first !== second && GLib.file_test(first, GLib.FileTest.EXISTS) && GLib.file_test(second, GLib.FileTest.EXISTS), 'Two snips in the same second both exist');
    const loaded = GdkPixbuf.Pixbuf.new_from_file(first);
    assert(loaded.get_width() === 20 && loaded.get_height() === 20, 'The saved PNG decodes with the same size');
    for (const path of [first, second]) Gio.File.new_for_path(path).delete(null);
    Gio.File.new_for_path(folder).delete(null);
});

test('annotations are burnt into the exported image', () => {
    const base = cropRectangle(frame(), {x: 10, y: 20, width: 40, height: 40})!;
    assert(renderAnnotated(base, []) === base, 'No marks returns the original');
    const pen: Stroke = {tool: 'pen', color: [0, 1, 0], width: 6, points: [{x: 5, y: 20}, {x: 35, y: 20}]};
    const marked = renderAnnotated(base, [pen]);
    same(pixel(marked, 20, 20).slice(0, 3), [0, 255, 0], 'The pen stroke is opaque green');
    same(pixel(marked, 20, 35).slice(0, 3), [255, 0, 0], 'Pixels away from the stroke are unchanged');
    const highlighter: Stroke = {tool: 'highlighter', color: [1, 1, 0], width: 3, points: [{x: 5, y: 30}, {x: 35, y: 30}]};
    const lit = renderAnnotated(base, [highlighter]);
    assert(pixel(lit, 20, 30)[1] > 0 && pixel(lit, 20, 30)[1] < 255, 'The highlighter is translucent');
    assert(PALETTE.length >= 5 && typeof drawStrokes === 'function', 'Palette and drawing helper are exported');
});

test('wiring: command, hotkey, launcher entry, icons, manifest', () => {
    const main = readText(`${ROOT}/src/main.ts`), labwc = readText(`${ROOT}/config/labwc/rc.xml`);
    assert(/'screenshot', 'screenshot-app'/.test(main), 'dev-os-shell accepts screenshot and screenshot-app');
    assert(/<keybind key="W-S-s"><action name="Execute" command="dev-os-shell screenshot" \/>/.test(labwc), 'Super+Shift+S starts a snip');
    assert(/<keybind key="Print">/.test(labwc), 'Print Screen starts a snip too');
    const desktop = readText(`${ROOT}/data/applications/dev-os-screenshot.desktop`);
    assert(/Exec=dev-os-shell screenshot-app/.test(desktop) && /Icon=dev-os-screenshot/.test(desktop) && /\[Desktop Action Snip\]/.test(desktop), 'Launcher entry with a New snip action');
    for (const name of ['dev-os-screenshot', 'dev-os-screenshot-symbolic']) assert(GLib.file_test(`${ROOT}/data/icons/hicolor/scalable/apps/${name}.svg`, GLib.FileTest.EXISTS), `${name} icon`);
    const manifest = JSON.parse(readText(`${ROOT}/extensions/org.devos.screenshot/extension.json`));
    assert(manifest.id === 'org.devos.screenshot' && manifest.entry === 'org.devos.screenshot.js' && manifest.enabledByDefault === true && manifest.system === true, 'Manifest');
});
print(`${passed} screenshot tests passed`);
