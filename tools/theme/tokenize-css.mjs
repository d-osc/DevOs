// One-time migration: rewrites literal colors in GTK CSS into the shared theme tokens (@dv_*),
// keeping selectors and layout untouched. Usage: node tools/theme/tokenize-css.mjs <file.css> [more files]
// Each literal is classified by hue/chroma/lightness and by the property it is used in, so a mint
// background tint becomes an accent tint, a pale label color becomes the foreground token, and so on.
import {readFileSync, writeFileSync} from 'node:fs';

function rgbOf(text) {
    const h = text.replace('#', '');
    const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
}
function hsl([r, g, b]) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min, l = (max + min) / 2;
    let h = 0;
    if (c) {
        if (max === r) h = ((g - b) / c) % 6; else if (max === g) h = (b - r) / c + 2; else h = (r - g) / c + 4;
        h = (h * 60 + 360) % 360;
    }
    return {h, c, l};
}
const role = prop => {
    if (/^(box-shadow|text-shadow|-gtk-icon-shadow)$/.test(prop)) return 'shadow';
    if (/^(color|caret-color|-gtk-icon-palette)$/.test(prop)) return 'text';
    if (/^(border|outline)/.test(prop) || prop === 'border-color') return 'line';
    return 'surface';
};
const family = ({h, c}) => {
    if (c < 0.045) return 'neutral';
    if (h >= 140 && h <= 198 && c >= 0.06) return 'accent';
    if ((h <= 14 || h >= 340) && c >= 0.12) return 'error';
    if (h > 14 && h < 65 && c >= 0.12) return 'warning';
    if (h >= 65 && h < 140 && c >= 0.1) return 'success';
    if (h >= 245 && h < 340 && c >= 0.17) return 'purple';
    if (h >= 198 && h < 245 && c >= 0.2) return 'info';
    return 'neutral';
};

function classify(hex, prop, wrapped) {
    const color = hsl(rgbOf(hex)), fam = family(color), kind = role(prop), l = color.l;
    if (kind === 'shadow' && fam === 'neutral' || kind === 'shadow' && l < 0.2) return 'shadow';
    if (fam !== 'neutral') {
        const light = l >= 0.5;
        if (light) return {accent: kind === 'text' ? 'accent_fg' : 'accent', error: 'error', warning: 'warning', success: 'success', purple: 'purple', info: 'info'}[fam];
        if (kind === 'text' && l < 0.35) return 'on_accent';
        if (fam === 'accent' || fam === 'success' || fam === 'info') return l < 0.14 ? 'accent_t1' : l < 0.2 ? 'accent_t2' : l < 0.27 ? 'accent_t3' : 'accent_t4';
        if (fam === 'error') return l < 0.22 ? 'error_t1' : 'error_t2';
        if (fam === 'warning') return l < 0.22 ? 'warning_t1' : 'warning_t2';
        return 'purple_t1';
    }
    if (kind === 'text') return l >= 0.93 ? 'fg_strong' : l >= 0.78 ? 'fg' : l >= 0.52 ? 'fg_muted' : l >= 0.3 ? 'fg_dim' : 'on_accent';
    if (wrapped) return l >= 0.5 ? 'fg' : 'shade';
    if (kind === 'line') return l >= 0.6 ? 'fg_muted' : l >= 0.4 ? 'line3' : l >= 0.31 ? 'line2' : l >= 0.235 ? 'line1' : 'line0';
    if (l >= 0.78) return 'fg';
    if (l >= 0.5) return 'fg_muted';
    return l < 0.07 ? 's00' : l < 0.125 ? 's0' : l < 0.155 ? 's1' : l < 0.18 ? 's2' : l < 0.215 ? 's3' : l < 0.25 ? 's4' : l < 0.30 ? 's5' : l < 0.37 ? 's6' : 's7';
}

export function tokenize(css) {
    const used = new Map();
    const out = css.replace(/([a-z-]+)(\s*:\s*)([^;{}]*)(?=[;}])/g, (whole, prop, colon, value) => {
        if (!/#[0-9a-fA-F]{3,8}\b|rgba?\(|@ACCENT@/.test(value)) return whole;
        const note = token => { used.set(token, (used.get(token) ?? 0) + 1); return `@dv_${token}`; };
        let next = value;
        // rgba(r, g, b, a) -> alpha(token, a)
        next = next.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g, (_all, r, g, b, a) => {
            const hex = '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('');
            const token = note(classify(hex, prop, true));
            return a === undefined ? token : `alpha(${token}, ${a.startsWith('.') ? '0' + a : a})`;
        });
        next = next.replace(/alpha\(\s*(#[0-9a-fA-F]{3,8})\b/g, (_all, hex) => `alpha(${note(classify(hex, prop, true))}`);
        next = next.replace(/alpha\(\s*@ACCENT@/g, () => `alpha(${note(role(prop) === 'text' ? 'accent_fg' : 'accent')}`);
        next = next.replace(/@ACCENT@/g, () => note(role(prop) === 'text' ? 'accent_fg' : 'accent'));
        next = next.replace(/#[0-9a-fA-F]{3,8}\b/g, hex => note(classify(hex, prop, false)));
        return `${prop}${colon}${next}`;
    });
    return {css: out, used};
}

if (process.argv[1].endsWith('tokenize-css.mjs')) {
    for (const file of process.argv.slice(2)) {
        const {css, used} = tokenize(readFileSync(file, 'utf8'));
        writeFileSync(file, css);
        console.log(file, [...used].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
        const left = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g);
        if (left) console.log('  remaining literals:', left.length);
    }
}
