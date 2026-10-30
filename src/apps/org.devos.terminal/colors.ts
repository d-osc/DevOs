import {paletteFor, activeFamily, activeTheme, type ThemeFamily, type ThemeName} from '@dev-os/core';

// ANSI order: black, red, green, yellow, blue, magenta, cyan, white; followed by their bright variants.
// The sixteen colors, foreground and cursor are those of the theme's own terminal (VS Code 2026 or GitHub, Dark or Light).
function flatten(overlay: string, base: string) {
    const [, red, green, blue, alpha] = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(overlay) ?? [];
    if (alpha === undefined) return base;
    const channel = (offset: number, value: string) => Math.round(Number(value) * Number(alpha) + parseInt(base.slice(offset, offset + 2), 16) * (1 - Number(alpha))).toString(16).padStart(2, '0');
    return `#${channel(1, red)}${channel(3, green)}${channel(5, blue)}`;
}
export function terminalScheme(name: ThemeName, family: ThemeFamily = 'vscode') {
    const p = paletteFor(name, family);
    return {
        title: name === 'dark' ? 'Dark' : 'Light', background: p.terminalBg, foreground: p.terminalFg, accent: p.accentFg,
        selection: flatten(p.terminalSelection, p.terminalBg),
        // Bold text uses the bright variants on VS Code Dark, where the plain ANSI red and blue are dim on the terminal background.
        boldIsBright: family === 'vscode' && name === 'dark',
        palette: Array.from({length: 16}, (_, index) => p[`ansi${index}` as keyof typeof p]) as string[],
    };
}
/** The scheme of the theme that is showing now. */
export const currentTerminalScheme = () => terminalScheme(activeTheme(), activeFamily());
/** The default family's schemes, by variant. */
export const terminalSchemes = {dark: terminalScheme('dark'), light: terminalScheme('light')};
