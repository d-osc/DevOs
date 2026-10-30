import {React, Gtk, Gdk, GLib, Gio, createRoot, activeTheme, activeFamily, palettes, paletteFor, onThemeChange, type UIContext, type ThemeName} from '@dev-os/core';
import {ROOT, DEFAULTS} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import theme from '../src/apps/org.devos.theme/extension.js';
import {ThemeSettingsPage} from '../src/apps/org.devos.theme/settings-view.js';
import {themeOptions, themeFor} from '../src/apps/org.devos.theme/options.js';
import {testTheme} from './theme-helper.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = (ms = 100) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const clock = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
async function verify() {
    assert(themeOptions().mode === 'auto' && themeOptions({}).lightFrom === '07:00' && themeOptions({}).darkFrom === '19:00', 'Defaults to Auto with a 07:00 / 19:00 schedule');
    assert(themeOptions({palette: 'ocean'}).mode === 'dark' && themeOptions({palette: 'bad', accent: 'x'}).mode === 'auto', 'Old palette values migrate and never throw');
    assert(themeFor({mode: 'light'}) === 'light' && themeFor({mode: 'dark'}) === 'dark', 'Fixed modes');
    assert(themeFor({mode: 'auto'}, new Date(2026, 0, 1, 12, 0)) === 'light' && themeFor({mode: 'auto'}, new Date(2026, 0, 1, 23, 0)) === 'dark', 'Auto follows the clock');
    const temporary = GLib.dir_make_tmp('devos-theme-ui-XXXXXX');
    // An old settings file (version 1, Plum palette) must load without a validation error.
    GLib.mkdir_with_parents(`${temporary}/preferences`, 0o700);
    GLib.file_set_contents(`${temporary}/preferences/org.devos.theme.json`, JSON.stringify({version: 1, enabled: true, values: {palette: 'plum', useDesktopAccent: false, accent: '#abcdef'}}));
    const preferences = new ExtensionManager({system: `${ROOT}/src/apps`, components: `${ROOT}/src/system`, bundled: `${ROOT}/src/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    assert(!preferences.get('org.devos.theme').error && preferences.get('org.devos.theme').state.values.mode === 'dark', 'Old saved Theme settings migrate to Dark');
    preferences.update('org.devos.theme', true, {mode: 'dark', lightFrom: '07:00', darkFrom: '19:00'});
    const display = Gdk.Display.get_default()!;
    let registered = false;
    const context: UIContext = {application: new Gtk.Application({application_id: 'org.devos.ThemeTest'}), display, preferences, config: () => DEFAULTS,
        saveCore() {}, monitors: () => [display.get_monitor(0)!], runCommand: () => true, reload: () => true, quit() {}, invoke() {},
        registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {},
        registerSettingsPage: () => {registered = true; return () => {};}};
    const changes: ThemeName[] = [];
    const stop = onThemeChange(name => changes.push(name));
    const cleanup = theme.activate(context);
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(760, 960);
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const find = <T extends Gtk.Widget>(id: string) => widgets(container).find(widget => widget.name === id) as T;
    const background = () => window.get_style_context().get_background_color(Gtk.StateFlags.NORMAL);
    const near = (rgba: Gdk.RGBA, color: string) => [1, 3, 5].every((offset, index) => Math.abs(Math.round([rgba.red, rgba.green, rgba.blue][index]! * 255) - parseInt(color.slice(offset, offset + 2), 16)) <= 1);
    try {
        assert(registered, 'Theme registers its custom settings page');
        window.show_all(); await wait();
        assert(activeTheme() === 'dark' && near(background(), palettes.dark.s1), 'Saved Dark applies the Dark 2026 surface to the real GTK window');
        root.render(<ThemeSettingsPage preferences={preferences} />); window.show_all(); await wait();
        assert(find<Gtk.Button>('theme-mode-auto') && find<Gtk.Button>('theme-mode-dark') && find<Gtk.Button>('theme-mode-light'), 'Auto, Dark and Light are offered');
        find<Gtk.Button>('theme-mode-light').emit('clicked'); await wait();
        assert(preferences.get('org.devos.theme').state.values.mode === 'dark' && near(background(), palettes.dark.s1), 'A draft does not change the real theme');
        find<Gtk.Button>('theme-settings-apply').emit('clicked'); await wait();
        assert(preferences.get('org.devos.theme').state.values.mode === 'light' && activeTheme() === 'light' && near(background(), palettes.light.s1), 'Apply live-reloads the whole stylesheet to Light');
        assert(changes.at(-1) === 'light', 'Other extensions are notified of the switch');
        find<Gtk.Button>('theme-family-github').emit('clicked'); await wait();
        assert(activeFamily() === 'vscode' && near(background(), palettes.light.s1), 'Choosing a color theme is only a draft until Apply');
        find<Gtk.Button>('theme-settings-apply').emit('clicked'); await wait();
        assert(preferences.get('org.devos.theme').state.values.family === 'github' && activeFamily() === 'github' && activeTheme() === 'light' && near(background(), paletteFor('light', 'github').s1), 'Apply switches to the GitHub Light theme live');
        assert(!near(background(), palettes.light.s1) || paletteFor('light', 'github').s1 === palettes.light.s1, 'The two Light themes differ');
        find<Gtk.Button>('theme-mode-dark').emit('clicked'); find<Gtk.Button>('theme-settings-apply').emit('clicked'); await wait();
        assert(activeTheme() === 'dark' && near(background(), paletteFor('dark', 'github').s1), 'GitHub Dark applies the Primer surface');
        find<Gtk.Button>('theme-family-vscode').emit('clicked'); find<Gtk.Button>('theme-mode-light').emit('clicked'); find<Gtk.Button>('theme-settings-apply').emit('clicked'); await wait();
        assert(activeFamily() === 'vscode' && near(background(), palettes.light.s1), 'Back to VS Code Light');
        // Auto with a schedule that makes "now" Dark, then Light.
        const now = new Date(), earlier = new Date(now.getTime() - 3600000), later = new Date(now.getTime() + 3600000);
        const schedule = (from: string, to: string) => {
            find<Gtk.Button>('theme-mode-auto').emit('clicked');
            find<Gtk.Entry>('theme-light-from').set_text(from); find<Gtk.Entry>('theme-dark-from').set_text(to);
            find<Gtk.Button>('theme-settings-apply').emit('clicked');
        };
        find<Gtk.Button>('theme-mode-auto').emit('clicked'); await wait();
        find<Gtk.Entry>('theme-light-from').set_text('bad'); await wait();
        assert(!find('theme-settings-apply').sensitive && find('theme-schedule-error'), 'An invalid time cannot be applied and is explained');
        find<Gtk.Button>('theme-settings-reset').emit('clicked'); await wait();
        assert(find<Gtk.Entry>('theme-light-from').get_text() === '07:00', 'Reset restores the saved schedule');
        // Skip the schedule checks within an hour of midnight, where "an hour earlier/later" wraps the day.
        if (clock(now) >= '01:00' && clock(now) <= '22:59') {
            schedule(clock(later), clock(earlier)); await wait();
            assert(preferences.get('org.devos.theme').state.values.mode === 'auto' && activeTheme() === 'dark' && near(background(), palettes.dark.s1), 'Auto is Dark outside the Light period');
            schedule(clock(earlier), clock(later)); await wait();
            assert(activeTheme() === 'light' && near(background(), palettes.light.s1), 'Auto is Light inside the Light period');
            schedule(clock(later), clock(earlier)); await wait();
            assert(activeTheme() === 'dark', 'Auto switches back when the schedule changes');
        }
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (screenshot) {await wait(); window.get_pixbuf()!.savev(screenshot, 'png', [], []);}
    } finally {
        root.unmount(); window.destroy(); cleanup(); stop(); preferences.dispose();
        for (const relative of ['preferences/org.devos.theme.json', 'preferences', '']) {const file = Gio.File.new_for_path(`${temporary}/${relative}`); if (file.query_exists(null)) file.delete(null);}
    }
    assert(testTheme().includes('@define-color dv_s0'), 'Test helper emits tokens');
    print('PASS: Dark/Light/Auto resolution, old-settings migration, draft isolation, live GTK theme switching, schedule validation and Reset');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
