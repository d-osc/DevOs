import {React, Gtk, Gdk, GLib, Gio, createRoot, readText, type UIContext} from '@dev-os/core';
import {ROOT, DEFAULTS} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import theme from '../extensions/org.devos.theme/extension.js';
import {ThemeSettings} from '../extensions/org.devos.theme/settings-view.js';
import {themeOptions, themeAccent, themeStyle} from '../extensions/org.devos.theme/options.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    assert(themeOptions().palette === 'graphite' && themeAccent({}, '#123456') === '#123456', 'Defaults preserve Desktop accent and base theme');
    assert(themeAccent({useDesktopAccent: false, accent: '#abcdef'}, '#123456') === '#abcdef' && themeOptions({palette: 'bad'}).palette === 'graphite', 'Custom accent and safe palette fallback');
    const source = readText(`${ROOT}/extensions/org.devos.theme/style.css`);
    for (const palette of ['graphite', 'ocean', 'plum']) {
        const style = themeStyle(source, {palette}, '#88e0c0');
        assert(!style.includes('@ACCENT@'), 'All accent placeholders are replaced');
        new Gtk.CssProvider().load_from_data(new TextEncoder().encode(style));
    }
    const temporary = GLib.dir_make_tmp('devos-theme-ui-XXXXXX');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const display = Gdk.Display.get_default()!;
    let registered = false;
    const context: UIContext = {application: new Gtk.Application({application_id: 'org.devos.ThemeTest'}), display, preferences, config: () => DEFAULTS,
        saveCore() {}, monitors: () => [display.get_monitor(0)!], runCommand: () => true, reload: () => true, quit() {}, invoke() {},
        registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {},
        registerSettingsPage: () => {registered = true; return () => {};}};
    const cleanup = theme.activate(context);
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(760, 960);
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const find = <T extends Gtk.Widget>(id: string) => widgets(container).find(widget => widget.name === id) as T;
    const color = () => window.get_style_context().get_background_color(Gtk.StateFlags.NORMAL);
    try {
        assert(registered, 'Theme registers its custom settings page');
        root.render(<ThemeSettings preferences={preferences} getAccent={() => DEFAULTS.accent} />); window.show_all(); await wait();
        const before = color().red;
        find<Gtk.Button>('theme-palette-ocean').emit('clicked'); find<Gtk.Button>('theme-accent-1').emit('clicked'); await wait();
        assert(preferences.get('org.devos.theme').state.values.palette === 'graphite' && Math.abs(color().red - before) < .001, 'Draft does not change real theme');
        find<Gtk.Button>('theme-settings-apply').emit('clicked'); await wait();
        assert(preferences.get('org.devos.theme').state.values.palette === 'ocean' && Math.abs(color().red - 23 / 255) < .01, 'Apply changes actual GTK surfaces through the theme extension');
        assert(preferences.get('org.devos.theme').state.values.accent === '#8ab4f8', 'Selected accent persists');
        find<Gtk.Entry>('theme-custom-accent').set_text('bad');
        assert(!find('theme-settings-apply').sensitive, 'Invalid custom color cannot be applied');
        find<Gtk.Button>('theme-settings-reset').emit('clicked');
        assert(find<Gtk.Entry>('theme-custom-accent').get_text() === '#8ab4f8', 'Reset restores saved color');
        find<Gtk.Switch>('theme-follow-accent').set_active(true); find<Gtk.Button>('theme-settings-apply').emit('clicked');
        assert(themeAccent(preferences.get('org.devos.theme').state.values, DEFAULTS.accent) === DEFAULTS.accent, 'Desktop accent inheritance is restored');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (screenshot) {await wait(); window.get_pixbuf()!.savev(screenshot, 'png', [], []);}
    } finally {
        root.unmount(); window.destroy(); cleanup(); preferences.dispose();
        for (const relative of ['preferences/org.devos.theme.json', 'preferences', '']) {const file = Gio.File.new_for_path(`${temporary}/${relative}`); if (file.query_exists(null)) file.delete(null);}
    }
    print('PASS: all theme palettes compile, draft isolation, live GTK theme application, accent inheritance, invalid colors and Reset');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
