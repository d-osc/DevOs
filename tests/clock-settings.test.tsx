import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Gio, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {ExtensionManager, clockFormat, clockDisplayFormat} from '@dev-os/extensions';
import {ClockSettings} from '../extensions/org.devos.clock/settings-view.js';

Gtk.init(null);
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function widgets(widget: Gtk.Widget): Gtk.Widget[] { return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])]; }
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => { resolve(); return GLib.SOURCE_REMOVE; }));
async function verify() {
    const temporary = GLib.dir_make_tmp('devos-clock-ui-XXXXXX');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(760, 1080);
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const theme = new Gtk.CssProvider();
    theme.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(container).find(widget => widget.name === id) as T;
    let applied = 0;
    try {
        root.render(<ClockSettings preferences={preferences} fallback="%H:%M" applied={() => { applied++; }} />); await wait();
        assert(find<Gtk.Label>('clock-disabled-notice'), 'Disabled customization is explained');
        const before = find<Gtk.Label>('clock-live-time').get_text();
        assert(/^\d\d:\d\d$/.test(before), 'Live clock has a real time preview');
        find<Gtk.Button>('clock-preset-12-hour').emit('clicked');
        find<Gtk.Switch>('settings-field-showSeconds').set_active(true);
        assert(preferences.get('org.devos.clock').state.values.showSeconds === false, 'Preview does not change saved panel settings');
        find<Gtk.Switch>('settings-enable-extension').set_active(true);
        find<Gtk.Button>('clock-settings-apply').emit('clicked');
        assert(applied === 1 && clockFormat(preferences, 'fallback') === '%I:%M:%S %p', 'Apply matches the panel format including seconds');
        const ticking = find<Gtk.Label>('clock-live-time').get_text();
        for (let index = 0; index < 65 && find<Gtk.Label>('clock-live-time').get_text() === ticking; index++) await wait();
        assert(find<Gtk.Label>('clock-live-time').get_text() !== ticking && applied === 1, 'Live ticks update the preview without saving settings');
        find<Gtk.Entry>('settings-field-format').set_text('');
        assert(!find<Gtk.Button>('clock-settings-apply').get_sensitive(), 'An empty custom format cannot be applied');
        find<Gtk.Button>('settings-reset').emit('clicked');
        assert(find<Gtk.Entry>('settings-field-format').get_text() === '%I:%M %p', 'Reset restores the last applied style');
        assert(clockDisplayFormat('%H:%M:%S', true) === '%H:%M:%S', 'No duplicate seconds');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (screenshot) { window.show_all(); await wait(); window.get_pixbuf()!.savev(screenshot, 'png', [], []); }
        print('PASS: clock presets, live ticks, draft isolation, panel format, Apply, Reset and invalid format');
    } finally {
        root.unmount(); window.destroy(); preferences.dispose();
        for (const relative of ['preferences/org.devos.clock.json', 'preferences', '']) {
            const file = Gio.File.new_for_path(`${temporary}/${relative}`); if (file.query_exists(null)) file.delete(null);
        }
    }
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => { failed = error; }).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
