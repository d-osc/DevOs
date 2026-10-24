import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {LanguageSettings} from '../extensions/org.devos.settings/language-view.js';
import type {LanguageCatalog, LanguageControls, LanguagePreferences} from '../extensions/org.devos.settings/language.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    let saved: LanguagePreferences | undefined, destroyed = false, fail = false;
    const catalog: LanguageCatalog = {settings: {layouts: ['us', 'th'], shortcut: 'alt-shift'}, layouts: [{id: 'us', name: 'English (US)', sample: 'Hello'}, {id: 'th', name: 'ไทย — Thai (Kedmanee)', sample: 'สวัสดี'}, {id: 'de', name: 'Deutsch', sample: 'Hallo'}], shortcuts: [{id: 'alt-shift', name: 'Alt + Shift'}, {id: 'super-space', name: 'Super + Space'}]};
    const controls: LanguageControls = {async load() {return catalog;}, async save(value) {if (fail) throw new Error('Compositor unavailable'); saved = value; return {settings: value, applied: true};}, destroy() {destroyed = true;}};
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(850, 800);
    const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    try {
        root.render(<LanguageSettings controls={controls} />); window.show_all(); await wait();
        assert(find('language-remove-us') && find('language-remove-th') && !find<Gtk.Button>('language-apply').get_sensitive(), 'English/Thai load without unsaved changes');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        find<Gtk.ComboBoxText>('language-shortcut').set_active_id('super-space');
        find<Gtk.Button>('language-up-th').emit('clicked');
        find<Gtk.ComboBoxText>('language-add-choice').set_active_id('de'); find<Gtk.Button>('language-add').emit('clicked');
        find<Gtk.Button>('language-apply').emit('clicked'); await wait();
        assert(saved?.layouts.join(',') === 'th,us,de' && saved.shortcut === 'super-space' && find('language-status'), 'Apply saves language order, added language and shortcut');
        find<Gtk.Button>('language-remove-de').emit('clicked'); find<Gtk.Button>('language-reset').emit('clicked');
        assert(find('language-remove-de') && !find<Gtk.Button>('language-apply').get_sensitive(), 'Discard restores saved preferences');
        find<Gtk.Button>('language-remove-de').emit('clicked'); find<Gtk.Button>('language-remove-us').emit('clicked');
        assert(!find<Gtk.Button>('language-remove-th').get_sensitive(), 'Last keyboard language cannot be removed');
        fail = true; find<Gtk.Button>('language-apply').emit('clicked'); await wait();
        assert(find<Gtk.Label>('language-error').get_text().includes('Compositor unavailable') && find<Gtk.Button>('language-apply').get_sensitive(), 'Apply failure preserves draft and allows retry');
    } finally {root.unmount(); window.destroy(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css);}
    assert(destroyed, 'Unmount releases backend resources');
    print('PASS: Language UI, add/remove/reorder, shortcut save, discard, error and cleanup');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
