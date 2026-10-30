import {
    readJson, resolveTheme, msUntilSwitch, themeSettings, normalizeSchedule, scheduleError, parseClock, formatClock,
    palettes, familyPalettes, paletteSources, themeFamilyNames, themeTokens, themeTokenNames, DEFAULT_SCHEDULE, type ThemeFamily, type ThemeName
} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {migrateState} from '../packages/extensions/migrations.js';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const at = (hours: number, minutes = 0, seconds = 0) => new Date(2026, 5, 15, hours, minutes, seconds);
let count = 0;
function test(name: string, body: () => void) { body(); count++; print(`PASS: ${name}`); }

test('fixed modes ignore the clock', () => {
    for (const hour of [0, 6, 7, 12, 18, 19, 23]) {
        equal(resolveTheme('dark', at(hour), DEFAULT_SCHEDULE), 'dark', `dark at ${hour}`);
        equal(resolveTheme('light', at(hour), DEFAULT_SCHEDULE), 'light', `light at ${hour}`);
    }
});
test('Auto boundaries with the default 07:00 / 19:00 schedule', () => {
    const cases: [number, number, ThemeName][] = [[0, 0, 'dark'], [6, 59, 'dark'], [7, 0, 'light'], [7, 1, 'light'], [12, 0, 'light'],
        [18, 59, 'light'], [19, 0, 'dark'], [19, 1, 'dark'], [23, 59, 'dark']];
    for (const [hours, minutes, expected] of cases) equal(resolveTheme('auto', at(hours, minutes), DEFAULT_SCHEDULE), expected, `${hours}:${minutes}`);
    equal(resolveTheme('auto', at(6, 59, 59), DEFAULT_SCHEDULE), 'dark', 'seconds do not move the boundary');
    equal(resolveTheme('auto', {hours: 7, minutes: 0}), 'light', 'wall-clock input and default schedule');
});
test('Auto handles a schedule that wraps past midnight', () => {
    const night = {lightFrom: '20:00', darkFrom: '06:00'};
    const cases: [number, number, ThemeName][] = [[0, 0, 'light'], [5, 59, 'light'], [6, 0, 'dark'], [12, 0, 'dark'], [19, 59, 'dark'], [20, 0, 'light'], [23, 59, 'light']];
    for (const [hours, minutes, expected] of cases) equal(resolveTheme('auto', at(hours, minutes), night), expected, `${hours}:${minutes}`);
    equal(resolveTheme('auto', at(0, 0), {lightFrom: '00:00', darkFrom: '12:00'}), 'light', 'midnight start is inclusive');
    equal(resolveTheme('auto', at(23, 59), {lightFrom: '12:00', darkFrom: '00:00'}), 'light', 'Dark starting at midnight');
    equal(resolveTheme('auto', at(0, 0), {lightFrom: '12:00', darkFrom: '00:00'}), 'dark', 'Dark starting at midnight, at midnight');
});
test('invalid schedules fall back to the defaults', () => {
    for (const bad of [{lightFrom: '7:00', darkFrom: '19:00'}, {lightFrom: '07:00', darkFrom: '24:00'}, {lightFrom: '07:60', darkFrom: '19:00'},
        {lightFrom: 'noon', darkFrom: '19:00'}, {lightFrom: '', darkFrom: ''}, {lightFrom: 7, darkFrom: 19}, {lightFrom: '08:00', darkFrom: '08:00'}, {}]) {
        equal(normalizeSchedule(bad), DEFAULT_SCHEDULE, JSON.stringify(bad));
        equal(resolveTheme('auto', at(12), bad), 'light', `noon with ${JSON.stringify(bad)}`);
        equal(resolveTheme('auto', at(3), bad), 'dark', `3am with ${JSON.stringify(bad)}`);
    }
    assert(scheduleError({lightFrom: '07:00', darkFrom: '19:00'}) === '', 'Valid schedule has no error');
    assert(scheduleError({lightFrom: '7am', darkFrom: '19:00'}).includes('HH:MM'), 'Format error is explained');
    assert(scheduleError({lightFrom: '08:00', darkFrom: '08:00'}).includes('different'), 'Equal times are explained');
    equal([parseClock('00:00'), parseClock('23:59'), parseClock('24:00'), parseClock(' 07:05 '), parseClock(null)], [0, 1439, null, 425, null], 'parseClock');
    equal([formatClock(0), formatClock(425), formatClock(1440), formatClock(-1)], ['00:00', '07:05', '00:00', '23:59'], 'formatClock');
});
test('time until the next switch', () => {
    equal(msUntilSwitch('dark', at(12)), null, 'Dark never switches');
    equal(msUntilSwitch('light', at(12)), null, 'Light never switches');
    equal(msUntilSwitch('auto', at(6, 59, 30)), 30000, '30 seconds before Light');
    equal(msUntilSwitch('auto', at(7, 0, 0)), 12 * 3600000, 'at 07:00 the next switch is 19:00');
    equal(msUntilSwitch('auto', at(19, 0, 0)), 12 * 3600000, 'at 19:00 the next switch is 07:00');
    equal(msUntilSwitch('auto', at(23, 0, 0)), 8 * 3600000, 'across midnight');
    equal(msUntilSwitch('auto', at(18, 59, 59)), 1000, 'never less than a second');
    equal(msUntilSwitch('auto', at(10), {lightFrom: 'x', darkFrom: 'y'}), 9 * 3600000, 'invalid schedule uses defaults');
});
test('saved settings, including pre-Dark/Light values, always map to Auto, Dark or Light', () => {
    const base = {lightFrom: '07:00', darkFrom: '19:00'};
    equal(themeSettings({}), {mode: 'auto', family: 'vscode', ...base}, 'defaults');
    equal(themeSettings(undefined), {mode: 'auto', family: 'vscode', ...base}, 'no values');
    equal(themeSettings({palette: 'graphite', useDesktopAccent: true, accent: '#88e0c0'}).mode, 'auto', 'old default palette');
    equal(themeSettings({palette: 'ocean'}).mode, 'dark', 'old Ocean');
    equal(themeSettings({palette: 'plum'}).mode, 'dark', 'old Plum');
    equal(themeSettings({mode: 'LIGHT'}).mode, 'light', 'case-insensitive');
    equal(themeSettings({mode: 'dark', palette: 'plum'}).mode, 'dark', 'mode wins over palette');
    equal(themeSettings({mode: 'purple-haze'}).mode, 'auto', 'unknown name');
    equal(themeSettings({mode: 42 as unknown as string}).mode, 'auto', 'wrong type');
    equal(themeSettings({theme: 'paper'}).mode, 'light', 'old terminal scheme name');
    equal(themeSettings({mode: 'auto', lightFrom: '06:30', darkFrom: '21:15'}), {mode: 'auto', family: 'vscode', lightFrom: '06:30', darkFrom: '21:15'}, 'custom schedule');
    equal(themeSettings({lightFrom: '99:99'}).lightFrom, '07:00', 'bad time');
    const migrated = migrateState('org.devos.theme', {version: 1, enabled: true, values: {palette: 'plum', useDesktopAccent: false, accent: '#abcdef'}}) as {version: number; values: Record<string, unknown>};
    equal(migrated, {version: 2, enabled: true, values: {mode: 'dark', family: 'vscode', lightFrom: '07:00', darkFrom: '19:00'}}, 'theme state migration');
    equal(migrateState('org.devos.terminal', {version: 1, enabled: true, values: {scheme: 'paper', font: 'Mono 12'}}), {version: 2, enabled: true, values: {font: 'Mono 12'}}, 'terminal state drops the scheme');
    equal(migrateState('org.devos.files', {version: 1, enabled: true, values: {a: 1}}), {version: 1, enabled: true, values: {a: 1}}, 'other extensions untouched');
});
test('palettes are copied from the VS Code 2026 and GitHub theme files', () => {
    const read = (name: string) => readJson(`${ROOT}/src/apps/org.devos.theme/vscode/${name}.json`) as {colors: Record<string, string>; name: string};
    const files = {vscode: {dark: '2026-dark', light: '2026-light'}, github: {dark: 'github/dark-default', light: 'github/light-default'}} as const;
    const includes = {dark: 'dark_modern', light: 'light_modern'} as const;
    assert(read('2026-dark').name === '2026 Dark' && read('2026-light').name === '2026 Light', 'VS Code sources are the 2026 themes');
    assert(read('github/dark-default').name === 'GitHub Dark Default' && read('github/light-default').name === 'GitHub Light Default', 'GitHub sources are the Default themes');
    for (const family of themeFamilyNames) for (const name of ['dark', 'light'] as const) {
        const source = read(files[family][name]), included = family === 'vscode' ? read(includes[name]) : {colors: {} as Record<string, string>};
        let checked = 0;
        for (const [token, origin] of Object.entries(paletteSources[family][name])) {
            if (origin.startsWith('workbench default')) continue;
            const derived = /^(\S+) \((rgb|flat)\)$/.exec(origin), key = derived ? derived[1]! : origin;
            const raw = (source.colors[key] ?? included.colors[key])?.toLowerCase();
            assert(raw, `${family}/${name}.${token}: ${key} exists in the theme file`);
            const value = (familyPalettes[family][name] as Record<string, string>)[token]!;
            if (!derived && value.startsWith('#') && raw.length === 7) { assert(raw === value, `${family}/${name}.${token} = ${key} (${raw}), got ${value}`); checked++; }
            if (derived?.[2] === 'rgb') assert(raw.startsWith(value), `${family}/${name}.${token} keeps the hue of ${key}`);
        }
        assert(checked > 25, `${family}/${name}: ${checked} opaque colors verified against the source files`);
    }
    equal([palettes.dark.s0, palettes.dark.fg, palettes.dark.accent, palettes.light.s0, palettes.light.fg, palettes.light.accent],
        ['#121314', '#bfbfbf', '#297aa0', '#ffffff', '#202020', '#0069cc'], 'anchor colors of Dark 2026 and Light 2026');
    equal(palettes.dark.ansi2 + palettes.dark.ansi12 + palettes.light.ansi1, '#0dbc79#3b8eea#cd3131', 'terminal ANSI defaults');
    const github = familyPalettes.github;
    equal([github.dark.s1, github.dark.fgStrong, github.dark.accentFg, github.light.s1, github.light.fgStrong, github.light.accent, github.dark.ansi2, github.light.ansi2],
        ['#0d1117', '#e6edf3', '#2f81f7', '#ffffff', '#1f2328', '#0969da', '#3fb950', '#116329'], 'anchor colors of GitHub Dark and Light Default');
});
test('the color theme family is saved, validated and defaults to VS Code', () => {
    equal(themeSettings({}).family, 'vscode', 'default family');
    equal(themeSettings({family: 'github'}).family, 'github', 'GitHub');
    equal(themeSettings({family: ' GitHub '}).family, 'github', 'case and space');
    equal(themeSettings({family: 'solarized'}).family, 'vscode', 'unknown family');
    equal(themeSettings({family: 3 as unknown as string}).family, 'vscode', 'wrong type');
    equal(themeSettings({mode: 'light', family: 'github'}), {mode: 'light', family: 'github', lightFrom: '07:00', darkFrom: '19:00'}, 'combined');
    assert(themeTokens('dark', 'github').includes('@define-color dv_s1 #0d1117;') && themeTokens('light', 'github').includes('@define-color dv_accent #0969da;'), 'tokens follow the family');
    assert(themeTokens('dark') === themeTokens('dark', 'vscode') && themeTokens('dark', 'github') !== themeTokens('dark'), 'families differ');
});
test('both themes define the same tokens and compile', () => {
    const names = (name: ThemeName, family: ThemeFamily) => [...themeTokens(name, family).matchAll(/@define-color dv_(\w+)/g)].map(m => m[1]);
    for (const family of themeFamilyNames) for (const name of ['dark', 'light'] as const) equal(names(name, family), names('dark', 'vscode'), `same token names in ${family}/${name}`);
    assert(themeTokenNames.length > 50 && themeTokenNames.includes('accent') && themeTokenNames.includes('fg'), 'Token list is exposed');
});
print(`PASS: ${count} theme checks`);
