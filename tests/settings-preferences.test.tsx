import {React, Gtk, Gdk, GLib, Gio, createRoot} from '@dev-os/core';
import {ROOT, DEFAULTS} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {SettingsView} from '../extensions/org.devos.settings/view.js';
import {settingsOptions, settingsStartPage} from '../extensions/org.devos.settings/options.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    assert(settingsOptions().closeOnEscape && !settingsOptions().rememberPage, 'Previous keyboard and reopening defaults are preserved');
    assert(settingsStartPage({}, 'bluetooth') === 'system' && settingsStartPage({rememberPage: true}, 'bluetooth') === 'bluetooth', 'Settings defaults to System while respecting the remember preference');
    assert(settingsStartPage({rememberPage: true}, 'bluetooth', 'wifi') === 'wifi', 'Explicit navigation overrides remembered page');
    const temporary = GLib.dir_make_tmp('devos-settings-ui-XXXXXX');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(1040, 820);
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const theme = new Gtk.CssProvider(); theme.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replaceAll('@ACCENT@', '#88e0c0')));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(container).find(widget => widget.name === id) as T;
    const compactSidebar = () => widgets(container).some(widget => widget.get_style_context().has_class('settings-sidebar-compact'));
    let lastPage = '';
    try {
        root.render(<SettingsView services={{extensions: preferences, getCore: () => DEFAULTS, saveCore() {}, applied() {}}} initialPage="org.devos.settings" onPageChanged={value => {lastPage = value;}} />); await wait();
        find<Gtk.Switch>('settings-option-compactNavigation').set_active(true);
        assert(find('settings-preview-navigation').get_style_context().has_class('settings-preview-compact') && !compactSidebar(), 'Draft changes only the preview');
        find<Gtk.Switch>('settings-option-rememberPage').set_active(true);
        find<Gtk.Switch>('settings-option-closeOnEscape').set_active(false);
        find<Gtk.Button>('settings-app-apply').emit('clicked');
        const saved = preferences.get('org.devos.settings').state.values;
        assert(saved.rememberPage && saved.compactNavigation && !saved.closeOnEscape && compactSidebar(), 'Apply saves and updates real navigation immediately');
        find<Gtk.Switch>('settings-option-closeOnEscape').set_active(true);
        find<Gtk.Button>('settings-app-reset').emit('clicked');
        assert(!find<Gtk.Switch>('settings-option-closeOnEscape').active, 'Reset restores applied choices');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (screenshot) {window.show_all(); await wait(); window.get_pixbuf()!.savev(screenshot, 'png', [], []);}
        find<Gtk.SearchEntry>('settings-search').set_text('Clock');
        assert(find('settings-nav-org.devos.clock') && !find('settings-nav-org.devos.terminal'), 'Sidebar search remains usable');
        find<Gtk.Button>('settings-nav-org.devos.clock').emit('clicked');
        assert(lastPage === 'org.devos.clock', 'Navigation records the page for reopening');
    } finally {
        root.unmount(); window.destroy(); preferences.dispose();
        for (const relative of ['preferences/org.devos.settings.json', 'preferences', '']) {const file = Gio.File.new_for_path(`${temporary}/${relative}`); if (file.query_exists(null)) file.delete(null);}
    }
    print('PASS: Settings preview isolation, Apply/Reset, live compact sidebar, search, remembered navigation and explicit page priority');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
