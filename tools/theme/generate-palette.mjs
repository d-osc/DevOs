// Regenerates packages/core/theme-palette.ts from the copied VS Code 2026 and GitHub theme files.
// Usage: node tools/theme/generate-palette.mjs
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = name => JSON.parse(readFileSync(`${root}extensions/org.devos.theme/vscode/${name}.json`, 'utf8'));

const hex = text => text.toLowerCase();
function parse(text) {
    const h = text.replace('#', '');
    const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
    return {r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1};
}
const toHex = ({r, g, b}) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
/** Opaque color: alpha hex values are flattened onto the given backdrop. */
function flatten(text, backdrop) {
    const c = parse(text); if (c.a === 1) return hex(text);
    const back = parse(backdrop);
    return toHex({r: c.r * c.a + back.r * (1 - c.a), g: c.g * c.a + back.g * (1 - c.a), b: c.b * c.a + back.b * (1 - c.a)});
}
/** Translucent color as a GTK rgba() expression. */
function rgba(text) {
    const c = parse(text);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`;
}

// VS Code core defaults (workbench terminalColorRegistry); the 2026 theme files do not define the ANSI colors.
const vscodeAnsi = {
    dark: ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
        '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5'],
    light: ['#000000', '#cd3131', '#107c10', '#949800', '#0451a5', '#bc05bc', '#0598bc', '#555555',
        '#666666', '#f14c4c', '#14ce14', '#b5ba00', '#3b8eea', '#d670d6', '#29b8db', '#a5a5a5'],
};
const ansiNames = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'];
const ansiKeys = [...ansiNames, ...ansiNames.map(name => `Bright${name}`)];

// A token spec is a color key, or {key, as: 'rgb'} to drop a translucent source's alpha (the hue is wanted), or
// {key, as: 'flat'} to composite it over the editor background. A list is [dark, light]; one entry serves both themes.
const vscodeMap = {
    s0: ['editor.background'], s1: ['sideBar.background'], s2: ['editorWidget.background'], s3: ['textBlockQuote.background'],
    s4: ['list.inactiveSelectionBackground'], s5: ['inputOption.activeBackground'],
    line0: ['widget.border'], line1: ['dropdown.border'], line3: ['checkbox.border'],
    fg: ['foreground'], fgStrong: ['list.activeSelectionForeground'], fgMuted: ['descriptionForeground'], fgDim: ['disabledForeground'],
    accent: ['button.background'], accentHover: ['button.hoverBackground'], accentFg: ['textLink.foreground'], onAccent: ['button.foreground'],
    focus: [{key: 'focusBorder', as: 'rgb'}], badge: ['badge.background'],
    error: ['errorForeground'], warning: ['list.warningForeground', 'problemsWarningIcon.foreground'],
    success: ['gitDecoration.addedResourceForeground'], info: ['notificationsInfoIcon.foreground'],
    errorBg: ['inputValidation.errorBackground'], errorLine: ['inputValidation.errorBorder'],
    warningBg: ['inputValidation.warningBackground'], warningLine: ['inputValidation.warningBorder'],
    infoBg: ['inputValidation.infoBackground'], infoLine: ['inputValidation.infoBorder'],
    purple: ['charts.purple'], blue: ['charts.blue'], yellow: ['charts.yellow'], orange: ['charts.orange'], green: ['charts.green'], red: ['charts.red'],
    editorBg: ['editor.background'], editorFg: ['editor.foreground'], terminalBg: ['terminal.background', 'panel.background'],
    cursor: ['terminalCursor.foreground'], lineHighlight: ['editor.lineHighlightBackground'],
};
const vscodeAlpha = {
    selection: 'list.activeSelectionBackground', hover: 'list.hoverBackground', menuSelection: 'menu.selectionBackground',
    scrollbar: 'scrollbarSlider.background', editorSelection: 'editor.selectionBackground', terminalSelection: 'terminal.selectionBackground',
};
// The GitHub themes (primer/github-vscode-theme, "GitHub Dark Default" / "GitHub Light Default") are sparser, so some
// tokens come from the keys that carry the matching Primer role. Elevation runs s0 (inset) .. s5 (strongest fill).
const githubMap = {
    s0: ['sideBar.background'], s1: ['editor.background'], s2: ['dropdown.background'],
    s3: ['checkbox.background', 'textBlockQuote.background'], s4: ['welcomePage.buttonBackground', 'button.secondaryBackground'],
    s5: ['button.secondaryBackground', 'textSeparator.foreground'],
    line0: ['textSeparator.foreground'], line1: ['input.border'], line3: ['editorWhitespace.foreground', 'editorLineNumber.foreground'],
    fg: ['button.secondaryForeground'], fgStrong: ['foreground'], fgMuted: ['descriptionForeground'], fgDim: ['editorWhitespace.foreground', 'editorLineNumber.foreground'],
    accent: ['badge.background'], accentHover: [{key: 'list.focusBackground', as: 'rgb'}, 'symbolIcon.booleanForeground'],
    accentFg: ['textLink.foreground'], onAccent: ['badge.foreground'], focus: ['focusBorder'], badge: ['badge.background'],
    error: ['errorForeground'], warning: ['notificationsWarningIcon.foreground', 'debugConsole.warningForeground'],
    success: ['gitDecoration.addedResourceForeground'], info: ['notificationsInfoIcon.foreground'],
    errorBg: [{key: 'diffEditor.removedLineBackground', as: 'flat'}], errorLine: ['statusBar.debuggingBackground'],
    warningBg: [{key: 'editorGutter.modifiedBackground', as: 'flat'}], warningLine: [{key: 'editorGutter.modifiedBackground', as: 'rgb'}],
    infoBg: [{key: 'list.focusBackground', as: 'flat'}], infoLine: ['focusBorder'],
    purple: ['symbolIcon.functionForeground'], blue: ['symbolIcon.keyForeground'], yellow: ['terminal.ansiBrightYellow', 'notificationsWarningIcon.foreground'],
    orange: ['symbolIcon.classForeground'], green: ['symbolIcon.numberForeground'], red: ['symbolIcon.keywordForeground'],
    editorBg: ['editor.background'], editorFg: ['editor.foreground'], terminalBg: ['editor.background'],
    cursor: ['editorCursor.foreground'], lineHighlight: [{key: 'editor.lineHighlightBackground', as: 'flat'}],
};
const githubAlpha = {
    selection: 'list.activeSelectionBackground', hover: 'list.hoverBackground', menuSelection: 'list.focusBackground',
    scrollbar: 'scrollbarSlider.background', editorSelection: 'list.focusBackground', terminalSelection: 'list.focusBackground',
};

const families = {
    vscode: {
        files: {dark: '2026-dark', light: '2026-light'}, include: {dark: 'dark_modern', light: 'light_modern'},
        map: vscodeMap, alpha: vscodeAlpha, ansi: vscodeAnsi, terminalFg: {dark: '#cccccc', light: '#333333'},
        ansiSource: 'workbench default terminal.ansi',
    },
    github: {
        files: {dark: 'github/dark-default', light: 'github/light-default'}, include: {},
        map: githubMap, alpha: githubAlpha, terminalFgKey: 'terminal.foreground', ansiFromTheme: true,
    },
};

const out = {}, trace = {}, syntax = {};
for (const [family, config] of Object.entries(families)) {
    out[family] = {dark: {}, light: {}}; trace[family] = {dark: {}, light: {}}; syntax[family] = {};
    for (const mode of ['dark', 'light']) {
        const source = read(config.files[mode]);
        const included = config.include[mode] ? read(config.include[mode]) : {colors: {}};
        const value = key => source.colors[key] ?? included.colors[key];
        const backdrop = value('editor.background');
        for (const [token, specs] of Object.entries(config.map)) {
            const spec = mode === 'dark' || specs.length === 1 ? specs[0] : specs[1];
            const key = typeof spec === 'string' ? spec : spec.key, as = typeof spec === 'string' ? 'solid' : spec.as;
            const raw = value(key);
            if (!raw) throw new Error(`${family}/${mode}: ${key} missing for ${token}`);
            out[family][mode][token] = as === 'rgb' ? hex(raw.slice(0, 7)) : flatten(raw, backdrop);
            trace[family][mode][token] = as === 'solid' ? key : `${key} (${as})`;
        }
        for (const [token, key] of Object.entries(config.alpha)) {
            const raw = value(key);
            if (!raw) throw new Error(`${family}/${mode}: ${key} missing`);
            out[family][mode][token] = rgba(raw); trace[family][mode][token] = key;
        }
        if (config.ansiFromTheme) {
            out[family][mode].terminalFg = hex(value(config.terminalFgKey)); trace[family][mode].terminalFg = config.terminalFgKey;
            ansiKeys.forEach((name, index) => {
                const key = `terminal.ansi${name}`, raw = value(key);
                if (!raw) throw new Error(`${family}/${mode}: ${key} missing`);
                out[family][mode][`ansi${index}`] = hex(raw); trace[family][mode][`ansi${index}`] = key;
            });
        } else {
            out[family][mode].terminalFg = config.terminalFg[mode]; trace[family][mode].terminalFg = 'workbench default terminal.foreground';
            config.ansi[mode].forEach((color, index) => { out[family][mode][`ansi${index}`] = color; trace[family][mode][`ansi${index}`] = `${config.ansiSource} ${index}`; });
        }
        syntax[family][mode] = source.tokenColors
            .flatMap(rule => (Array.isArray(rule.scope) ? rule.scope : [rule.scope]).map(scope => ({scope, foreground: rule.settings.foreground ? hex(rule.settings.foreground) : undefined, fontStyle: rule.settings.fontStyle})))
            .filter(rule => rule.foreground || rule.fontStyle);
    }
}

const body = `// Generated by tools/theme/generate-palette.mjs from the VS Code 2026 Dark/Light themes and the GitHub Dark/Light
// Default themes (extensions/org.devos.theme/vscode, both MIT). Do not edit by hand; see extensions/org.devos.theme/NOTICE.md.
export type ThemeName = 'dark' | 'light';
export type ThemeFamily = 'vscode' | 'github';
export type PaletteToken = ${Object.keys(out.vscode.dark).map(key => `'${key}'`).join(' | ')};
export type Palette = Readonly<Record<PaletteToken, string>>;
export interface TokenRule {readonly scope: string; readonly foreground?: string; readonly fontStyle?: string}

export const familyPalettes: Readonly<Record<ThemeFamily, Readonly<Record<ThemeName, Palette>>>> = Object.freeze(${JSON.stringify(out, null, 4)});

/** Which theme-file color key each token was copied from (per family and theme). */
export const paletteSources: Readonly<Record<ThemeFamily, Readonly<Record<ThemeName, Readonly<Record<string, string>>>>>> = Object.freeze(${JSON.stringify(trace, null, 4)});

/** The tokenColors of each theme, flattened to one rule per scope. */
export const syntaxRules: Readonly<Record<ThemeFamily, Readonly<Record<ThemeName, readonly TokenRule[]>>>> = Object.freeze(${JSON.stringify(syntax)});

/** The default family (VS Code 2026), kept as a shorthand. */
export const palettes: Readonly<Record<ThemeName, Palette>> = familyPalettes.vscode;
`;
writeFileSync(`${root}packages/core/theme-palette.ts`, body);
console.log('wrote packages/core/theme-palette.ts');
