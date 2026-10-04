import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {ROOT, DEFAULTS, validateConfig, loadConfig, configPath, expandHome} from '../src/config.js';
import {searchApps, findDesktopApp} from '../src/apps.js';
// Import the UI without constructing windows: syntax / GI binding checks.
import {DesktopShell} from '../src/shell.js';

let count = 0;
function assert(condition: unknown, message = 'Assertion failed') { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected)); }
function throws(callback: () => unknown) {
    let failed = false;
    try { callback(); } catch { failed = true; }
    assert(failed, 'Expected validation error');
}
function test(name: string, callback: () => void) { callback(); count++; print(`PASS: ${name}`); }

test('defaults and missing configuration', () => {
    equal(validateConfig({}), DEFAULTS);
    equal(loadConfig('/nonexistent/dev-os-test/config.json'), DEFAULTS);
});
test('partial overrides keep defaults', () => {
    const config = validateConfig({accent: '#abcdef', terminal: ['foot', '--title=My terminal']});
    equal(config.terminal, ['foot', '--title=My terminal']);
    equal(config.accent, '#abcdef'); equal(config.panel_height, 36);
});
test('invalid colors rejected', () => {
    for (const accent of ['red', '#fff', '#00xx00', '#FFFFFF; background:red', 1])
        throws(() => validateConfig({accent}));
});
test('commands are non-empty arrays of non-empty strings', () => {
    for (const terminal of ['foot; echo hello', [], ['foot', 1], [''], ['a\0b']])
        throws(() => validateConfig({terminal}));
});
test('arguments remain literal', () => {
    equal(validateConfig({terminal: ['foot', '$(touch /tmp/should-not-exist)']}).terminal[1],
        '$(touch /tmp/should-not-exist)');
});
test('invalid height rejected', () => {
    for (const panel_height of [true, 10, 999, '48', 48.5]) throws(() => validateConfig({panel_height}));
});
test('unknown settings and invalid roots rejected', () => {
    for (const value of [{accnet: '#abcdef'}, null, [], 'settings']) throws(() => validateConfig(value));
});
test('autostart validation', () => {
    equal(validateConfig({autostart: [['mako'], ['kanshi', '-c', 'my config']]}).autostart,
        [['mako'], ['kanshi', '-c', 'my config']]);
    for (const autostart of ['mako', [[]], [['mako', null]]]) throws(() => validateConfig({autostart}));
});
test('configuration arrays do not mutate defaults', () => {
    const config = validateConfig({}); config.terminal.push('test');
    equal(validateConfig({}).terminal, ['dev-os-terminal']);
});
test('XDG path and home argument expansion', () => {
    equal(configPath(), `${GLib.get_user_config_dir()}/dev-os/config.json`);
    equal(expandHome('~'), GLib.get_home_dir());
    equal(expandHome('~/Documents'), `${GLib.get_home_dir()}/Documents`);
    equal(expandHome('$HOME'), '$HOME');
});
test('JSON config IO and malformed JSON', () => {
    const [fd, path] = GLib.file_open_tmp('dev-os-config-test-XXXXXX');
    GLib.close(fd);
    try {
        GLib.file_set_contents(path, JSON.stringify({name: 'My desktop', panel_height: 64}));
        equal(loadConfig(path).name, 'My desktop');
        GLib.file_set_contents(path, '{broken'); throws(() => loadConfig(path));
    } finally { Gio.File.new_for_path(path).delete(null); }
});
test('name matches rank above description and multiple terms filter', () => {
    const fake = (name: string, description: string) => ({get_display_name: () => name,
        get_description: () => description, get_id: () => name});
    const apps = [fake('Browser', 'Foot terminal documentation'), fake('Foot', 'Wayland terminal')];
    equal(searchApps(apps, 'foot').map(app => app.get_display_name()), ['Foot', 'Browser']);
    equal(searchApps(apps, 'foot wayland').map(app => app.get_display_name()), ['Foot']);
});
test('example config and every GJS UI module load', () => {
    assert(typeof DesktopShell === 'function');
    equal(loadConfig(`${ROOT}/config/config.json`), DEFAULTS);
});
test('taskbar resolves desktop IDs and StartupWMClass without confusing unrelated apps', () => {
    const editor = {get_id: () => 'com.microsoft.VSCode.desktop', get_startup_wm_class: () => 'Code'};
    const other = {get_id: () => 'Code.desktop', get_startup_wm_class: () => null};
    const apps = [editor, other];
    assert(findDesktopApp(apps, 'com.microsoft.VSCode') === editor);
    assert(findDesktopApp(apps, 'COM.MICROSOFT.VSCODE.DESKTOP') === editor);
    assert(findDesktopApp(apps, 'Code') === other, 'Desktop ID takes priority over a WM class alias');
    assert(findDesktopApp([editor], 'code') === editor, 'Legacy Code app ID uses StartupWMClass');
    assert(findDesktopApp(apps, '') === undefined && findDesktopApp(apps, 'unrelated') === undefined);
});
print(`\n${count} GJS tests passed`);
