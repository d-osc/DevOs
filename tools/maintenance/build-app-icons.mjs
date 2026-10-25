// GTK app icons use the same Font Awesome outlines extracted from assets/ as the shell.
// Run after build-fa-icons.py when updating assets; no font dependency is needed here.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root = new URL('../../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const {mapping} = read('data/icons/fa/index.json');
const duotone = read('data/icons/fa/duotone-solid.json');
const classic = read('data/icons/fa/classic-solid.json');
let count = 0;
for (const [name, glyphName] of Object.entries(mapping).filter(([name]) => name.startsWith('dev-os-'))) {
    const set = duotone.icons[glyphName] ? duotone : classic;
    const glyph = set.icons[glyphName];
    if (!glyph) throw new Error(`Missing app outline from assets/: ${name} (${glyphName})`);
    const side = Math.max(glyph.w, set.upm), offset = -(side - glyph.w) / 2;
    for (const symbolic of [false, true]) {
        const secondary = glyph.d2 ? `<path d="${glyph.d2}" opacity=".4"/>` : '';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="${offset} 0 ${side} ${side}"><!-- Font Awesome: assets/font/fa-${set === duotone ? 'duotone' : 'solid'}-900.woff2; ${glyphName} --><g fill="${symbolic ? '#2e3436' : '#57a5e5'}">${secondary}<path d="${glyph.d}"/></g></svg>\n`;
        writeFileSync(new URL(`data/icons/hicolor/scalable/apps/${name}${symbolic ? '-symbolic' : ''}.svg`, root), svg);
        count++;
    }
}
console.log(`Generated ${count} GTK app icons from assets/ outlines (${fileURLToPath(root)}).`);
