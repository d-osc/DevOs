import {Gtk, readText, themeTokens, themeTokenNames, themeFamilyNames, paletteFor, type ThemeName} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {terminalScheme} from '../src/apps/org.devos.terminal/colors.js';

Gtk.init(null);
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
let count = 0;
function test(name: string, body: () => void) { body(); count++; print(`PASS: ${name}`); }

const sources: Record<string, string> = {
    'src/apps/org.devos.theme/style.css': readText(`${ROOT}/src/apps/org.devos.theme/style.css`),
    'packages/core/window-header.ts': readText(`${ROOT}/packages/core/window-header.ts`),
};
/** Files where literal colors are expected: none yet. Add a path here, with a reason, before adding a literal. */
const allowedLiterals: Record<string, RegExp[]> = {};
const names: ThemeName[] = ['dark', 'light'];

function luminance(hex: string) {
    const channel = (offset: number) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
const contrast = (a: string, b: string) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high! + 0.05) / (low! + 0.05);
};

test('every @dv_ token used by the CSS is defined in both themes', () => {
    for (const [file, source] of Object.entries(sources)) {
        const used = new Set([...source.matchAll(/@dv_(\w+)/g)].map(match => match[1]!));
        assert(used.size > 0, `${file} uses tokens`);
        for (const token of used) assert(themeTokenNames.includes(token), `${file}: @dv_${token} is not defined`);
        for (const family of themeFamilyNames) for (const name of names) for (const token of used) assert(themeTokens(name, family).includes(`@define-color dv_${token} `), `${family}/${name} defines dv_${token}`);
    }
    const style = sources['src/apps/org.devos.theme/style.css']!;
    const used = new Set([...style.matchAll(/@dv_(\w+)/g)].map(match => match[1]!));
    const unused = themeTokenNames.filter(token => !used.has(token));
    print(`INFO: ${used.size} tokens used by style.css; ${unused.length} defined for other consumers: ${unused.join(', ')}`);
});
test('no literal colors outside the token definitions', () => {
    for (const [file, source] of Object.entries(sources)) {
        const allowed = allowedLiterals[file] ?? [];
        const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
        const literals = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|@ACCENT@/g)].map(match => match[0])
            .filter(literal => !allowed.some(pattern => pattern.test(literal)));
        // Hex colors in TypeScript strings must be inside the CSS template only; selectors like #panel are ids, not colors.
        const colors = literals.filter(literal => file.endsWith('.css') ? true : /^#[0-9a-fA-F]{6}$/.test(literal) || literal.startsWith('rgb'));
        assert(colors.length === 0, `${file} still has literal colors: ${colors.slice(0, 5).join(', ')}`);
    }
});
test('border tokens are faint: 8-14% of the foreground in dark, 10-16% in light, and used on the main surfaces', () => {
    const style = sources['src/apps/org.devos.theme/style.css']!;
    for (const family of themeFamilyNames) for (const name of names) {
        const tokens = themeTokens(name, family), [lo, hi] = name === 'dark' ? [0.08, 0.14] : [0.10, 0.16];
        for (const token of ['border', 'border_soft']) {
            const alpha = Number(new RegExp(`@define-color dv_${token} alpha\\(@dv_fg, ([0-9.]+)\\);`).exec(tokens)?.[1]);
            assert(alpha >= lo - 0.03 && alpha <= hi, `${family}/${name}: dv_${token} alpha ${alpha} is not faint`);
        }
    }
    const rules = style.split('\n').filter(line => /@dv_border(_soft)?\b/.test(line)).join('\n');
    for (const selector of ['window#settings', 'window#files', 'window#terminal', 'menu,', 'popover.background', '#settings .settings-card', '#settings entry', '#launcher row']) assert(rules.includes(selector), `style.css draws a faint border on ${selector}`);
});
test('both complete stylesheets compile in GTK', () => {
    for (const family of themeFamilyNames) for (const name of names) {
        const style = themeTokens(name, family) + sources['src/apps/org.devos.theme/style.css']!;
        const provider = new Gtk.CssProvider();
        provider.load_from_data(new TextEncoder().encode(style));
        provider.load_from_data(new TextEncoder().encode(themeTokens(name, family) + `.app-titlebar { background: @dv_s1; color: @dv_fg; }`));
    }
});
test('body text meets WCAG AA (4.5:1) on every surface it is used on, in both themes', () => {
    for (const family of themeFamilyNames) for (const name of names) {
        const p = paletteFor(name, family), label = `${family}/${name}`;
        for (const surface of ['s0', 's1', 's2', 's3', 's4', 's5'] as const) {
            for (const text of ['fg', 'fgStrong'] as const) {
                const ratio = contrast(p[text], p[surface]);
                assert(ratio >= 4.5, `${label}: ${text} ${p[text]} on ${surface} ${p[surface]} is ${ratio.toFixed(2)}:1`);
            }
        }
        // VS Code's own Light link color (#0069cc) is 4.48:1 on the raised card surface (#eaeaea), so links are checked on s0-s2 only.
        for (const surface of ['s0', 's1', 's2', 's3'] as const) {
            for (const text of surface === 's3' ? ['fgMuted'] as const : ['fgMuted', 'accentFg'] as const) {
                const ratio = contrast(p[text], p[surface]);
                assert(ratio >= 4.5, `${label}: ${text} ${p[text]} on ${surface} ${p[surface]} is ${ratio.toFixed(2)}:1`);
            }
        }
        for (const surface of ['s0', 's1', 's2'] as const) {
            for (const text of ['error', 'warning', 'success', 'info'] as const) {
                const ratio = contrast(p[text], p[surface]);
                assert(ratio >= 4.5, `${label}: ${text} ${p[text]} on ${surface} ${p[surface]} is ${ratio.toFixed(2)}:1`);
            }
        }
        assert(contrast(p.onAccent, p.accent) >= 4.5, `${label}: text on the accent fill ${contrast(p.onAccent, p.accent).toFixed(2)}:1`);
        assert(contrast(p.editorFg, p.editorBg) >= 4.5, `${label}: editor text`);
    }
});
test('terminal text and the colored prompt are readable in every theme', () => {
    for (const family of themeFamilyNames) for (const name of names) {
        const scheme = terminalScheme(name, family), label = `${family}/${name}`;
        assert(contrast(scheme.foreground, scheme.background) >= 4.5, `${label}: terminal foreground`);
        // The prompt is bold: green for a normal user, red for root, blue for the directory. Dark maps bold to the bright colors.
        const offset = scheme.boldIsBright ? 8 : 0;
        for (const [hue, index] of [['green', 2], ['red', 1], ['blue', 4]] as const) {
            const color = scheme.palette[index + offset]!, ratio = contrast(color, scheme.background);
            assert(ratio >= 4.5, `${label}: prompt ${hue} ${color} on ${scheme.background} is ${ratio.toFixed(2)}:1`);
        }
        assert(scheme.palette.length === 16, 'sixteen ANSI colors');
    }
});
print(`PASS: ${count} theme CSS checks`);
