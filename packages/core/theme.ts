import {familyPalettes, palettes, type Palette, type ThemeFamily, type ThemeName} from './theme-palette.js';
export {familyPalettes, palettes, paletteSources, syntaxRules, type Palette, type PaletteToken, type ThemeFamily, type ThemeName, type TokenRule} from './theme-palette.js';

export type ThemeMode = 'auto' | 'dark' | 'light';
export interface ThemeSchedule {lightFrom: string; darkFrom: string}
export interface ThemeSettings extends ThemeSchedule {mode: ThemeMode; family: ThemeFamily}
/** The color themes on offer; each has a Dark and a Light variant. VS Code 2026 is the default. */
export const themeFamilies: Readonly<Record<ThemeFamily, {title: string; detail: string}>> = Object.freeze({
    vscode: {title: 'VS Code 2026', detail: 'Default Dark and Light of Visual Studio Code'},
    github: {title: 'GitHub', detail: 'GitHub Dark Default and Light Default'},
});
export const themeFamilyNames = Object.keys(themeFamilies) as ThemeFamily[];
export const paletteFor = (name: ThemeName, family: ThemeFamily = 'vscode'): Palette => familyPalettes[family][name];
export const themeModes: readonly ThemeMode[] = ['auto', 'dark', 'light'];
/** Auto is Light from 07:00 until 19:00 and Dark otherwise, in local time. */
export const DEFAULT_SCHEDULE: Readonly<ThemeSchedule> = Object.freeze({lightFrom: '07:00', darkFrom: '19:00'});
export const DEFAULT_THEME_SETTINGS: Readonly<ThemeSettings> = Object.freeze({mode: 'auto', family: 'vscode', ...DEFAULT_SCHEDULE});

/** Minutes after midnight for a strict 24-hour HH:MM, or null. */
export function parseClock(text: unknown): number | null {
    const match = typeof text === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text.trim()) : null;
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
export const validClock = (text: unknown) => parseClock(text) !== null;
export function formatClock(minutes: number): string {
    const value = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/** A schedule needs two valid, different times; anything else falls back to the defaults. */
export function normalizeSchedule(schedule: Partial<Record<keyof ThemeSchedule, unknown>> = {}): ThemeSchedule {
    const light = parseClock(schedule.lightFrom), dark = parseClock(schedule.darkFrom);
    if (light === null || dark === null || light === dark) return {...DEFAULT_SCHEDULE};
    return {lightFrom: formatClock(light), darkFrom: formatClock(dark)};
}
/** Why a schedule would be rejected, for the Settings page. */
export function scheduleError(schedule: ThemeSchedule): string {
    const light = parseClock(schedule.lightFrom), dark = parseClock(schedule.darkFrom);
    if (light === null || dark === null) return 'Enter times as HH:MM in 24-hour time, for example 07:00.';
    if (light === dark) return 'Light and Dark must start at different times.';
    return '';
}

type Moment = Date | {hours: number; minutes: number; seconds?: number; milliseconds?: number};
function wall(now: Moment) {
    return now instanceof Date
        ? {hours: now.getHours(), minutes: now.getMinutes(), seconds: now.getSeconds(), milliseconds: now.getMilliseconds()}
        : {hours: now.hours, minutes: now.minutes, seconds: now.seconds ?? 0, milliseconds: now.milliseconds ?? 0};
}

/**
 * The theme to show at `now`. Dark and Light are fixed; Auto is Light from `lightFrom` (inclusive) until
 * `darkFrom` (exclusive), wrapping past midnight when the Light period is entered later than it ends.
 * Only the local wall clock matters, so daylight-saving changes need no special handling.
 */
export function resolveTheme(mode: ThemeMode, now: Moment, schedule: Partial<Record<keyof ThemeSchedule, unknown>> = DEFAULT_SCHEDULE): ThemeName {
    if (mode === 'dark' || mode === 'light') return mode;
    const {lightFrom, darkFrom} = normalizeSchedule(schedule);
    const light = parseClock(lightFrom)!, dark = parseClock(darkFrom)!;
    const time = wall(now), minute = time.hours * 60 + time.minutes;
    const lit = light < dark ? minute >= light && minute < dark : minute >= light || minute < dark;
    return lit ? 'light' : 'dark';
}

/** Milliseconds until the next Auto switch (at least 1 s), or null when the mode is fixed. */
export function msUntilSwitch(mode: ThemeMode, now: Moment, schedule: Partial<Record<keyof ThemeSchedule, unknown>> = DEFAULT_SCHEDULE): number | null {
    if (mode !== 'auto') return null;
    const {lightFrom, darkFrom} = normalizeSchedule(schedule);
    const time = wall(now), elapsed = ((time.hours * 60 + time.minutes) * 60 + time.seconds) * 1000 + time.milliseconds;
    const ahead = [parseClock(lightFrom)!, parseClock(darkFrom)!].map(minute => {
        const delta = minute * 60000 - elapsed;
        return delta > 0 ? delta : delta + 86400000;
    });
    return Math.max(1000, Math.min(...ahead));
}

/**
 * Reads the Theme extension's saved values. Anything unrecognised becomes Auto, never an error. Settings
 * written before Dark/Light existed named a workspace palette: Ocean and Plum were deliberate dark choices
 * and become Dark, while Graphite (the old default) and everything else becomes Auto.
 */
export function themeSettings(values: Record<string, unknown> = {}): ThemeSettings {
    const raw = typeof values.mode === 'string' ? values.mode : typeof values.theme === 'string' ? values.theme : '';
    const named = raw.trim().toLowerCase();
    let mode: ThemeMode = 'auto';
    if ((themeModes as readonly string[]).includes(named)) mode = named as ThemeMode;
    else if (!named && (values.palette === 'ocean' || values.palette === 'plum')) mode = 'dark';
    else if (named === 'midnight' || named === 'slate') mode = 'dark';
    else if (named === 'paper') mode = 'light';
    const family = typeof values.family === 'string' && Object.hasOwn(themeFamilies, values.family.trim().toLowerCase()) ? values.family.trim().toLowerCase() as ThemeFamily : 'vscode';
    return {mode, family, ...normalizeSchedule(values)};
}

const hexPattern = /^#[0-9a-f]{6}$/i;
/** The `@define-color` block of one theme. Every color the shell's CSS uses is defined here. */
export function themeTokens(name: ThemeName, family: ThemeFamily = 'vscode'): string {
    const p = paletteFor(name, family);
    const tint = (base: string, color: string, amount: number) => `mix(@dv_${base}, @dv_${color}, ${amount})`;
    const colors: Record<string, string> = {
        s00: name === 'dark' ? `mix(@dv_s0, #000000, 0.45)` : '@dv_s0',
        s0: p.s0, s1: p.s1, s2: p.s2, s3: p.s3, s4: p.s4, s5: p.s5,
        s6: 'mix(@dv_s5, @dv_fg, 0.10)', s7: 'mix(@dv_s5, @dv_fg, 0.22)',
        line0: p.line0, line1: p.line1, line2: 'mix(@dv_line1, @dv_line3, 0.5)', line3: p.line3,
        fg: p.fg, fg_strong: p.fgStrong, fg_muted: p.fgMuted, fg_dim: p.fgDim,
        accent: p.accent, accent_hover: p.accentHover, accent_fg: p.accentFg, on_accent: p.onAccent, focus: p.focus, badge: p.badge,
        accent_t1: tint('s2', 'accent', 0.14), accent_t2: tint('s2', 'accent', 0.22), accent_t3: tint('s2', 'accent', 0.34), accent_t4: tint('s2', 'accent', 0.5),
        error: p.error, warning: p.warning, success: p.success, info: p.info,
        error_bg: p.errorBg, error_line: p.errorLine, warning_bg: p.warningBg, warning_line: p.warningLine, info_bg: p.infoBg, info_line: p.infoLine,
        error_t1: tint('s2', 'error', 0.14), error_t2: tint('s2', 'error', 0.28), warning_t1: tint('s2', 'warning', 0.14), warning_t2: tint('s2', 'warning', 0.28),
        purple: p.purple, purple_t1: tint('s2', 'purple', 0.16), blue: p.blue, yellow: p.yellow, orange: p.orange, green: p.green, red: p.red,
        selection: p.selection, hover: p.hover, menu_selection: p.menuSelection, scrollbar: p.scrollbar,
        terminal_bg: p.terminalBg, terminal_fg: p.terminalFg,
        // Not in the source themes: shadow ink and the veil used to dim a surface.
        shadow: '#000000', shade: name === 'dark' ? '#000000' : '#9a9aa6',
    };
    for (const [key, value] of Object.entries(colors)) if (!value.includes('(') && !value.startsWith('@') && !hexPattern.test(value)) throw new Error(`Bad ${family}/${name} token ${key}: ${value}`);
    return Object.entries(colors).map(([key, value]) => `@define-color dv_${key} ${value};`).join('\n') + '\n';
}
/** Names of every `@define-color` the themes provide, without the prefix. */
export const themeTokenNames: readonly string[] = Object.freeze([...themeTokens('dark').matchAll(/@define-color dv_(\w+)/g)].map(match => match[1]));
export const themeStyle = (source: string, name: ThemeName, family: ThemeFamily = 'vscode') => themeTokens(name, family) + source;

/** Colors for the drawn wallpaper and lock screen: the base, the accent glow and two text strengths. */
export function wallpaperColors(name: ThemeName = activeTheme(), family: ThemeFamily = activeFamily()) {
    const p = paletteFor(name, family);
    return {background: name === 'dark' ? p.s0 : p.s1, accent: p.accentFg, foreground: p.fgStrong, muted: p.fgMuted};
}

/** A `#rrggbb` color as 0-1 channels, for Cairo. */
export const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];

/** The theme currently shown. Shared by every extension in the process through `globalThis`. */
interface ThemeStore {name: ThemeName; family: ThemeFamily; listeners: Set<(name: ThemeName, family: ThemeFamily) => void>}
const storeKey = Symbol.for('org.devos.theme.store');
function store(): ThemeStore {
    const holder = globalThis as unknown as Record<symbol, ThemeStore | undefined>;
    return holder[storeKey] ??= {name: resolveTheme('auto', new Date()), family: 'vscode', listeners: new Set()};
}
export const activeTheme = (): ThemeName => store().name;
export const activeFamily = (): ThemeFamily => store().family;
export const activePalette = (): Palette => paletteFor(store().name, store().family);
/** Makes a theme current and tells every listener, unless neither the variant nor the family changed. */
export function setActiveTheme(name: ThemeName, family: ThemeFamily = store().family): void {
    const state = store();
    if (state.name === name && state.family === family) return;
    state.name = name; state.family = family;
    for (const listener of [...state.listeners]) listener(name, family);
}
export function onThemeChange(listener: (name: ThemeName, family: ThemeFamily) => void): () => void {
    const state = store(); state.listeners.add(listener);
    return () => { state.listeners.delete(listener); };
}
