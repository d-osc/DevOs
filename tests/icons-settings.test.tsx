import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Gio, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import icons from '../src/apps/org.devos.icons/extension.js';
import {IconsSettings} from '../src/apps/org.devos.icons/settings-view.js';
import {installedIconThemes} from '../src/apps/org.devos.icons/themes.js';
import {materialIcon} from '../src/apps/org.devos.icons/material.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    const temporary = GLib.dir_make_tmp('devos-icons-ui-XXXXXX');
    const themeDirectory = `${temporary}/icons/DevOSPreviewTest`;
    GLib.mkdir_with_parents(themeDirectory, 0o700);
    GLib.file_set_contents(`${themeDirectory}/index.theme`, '[Icon Theme]\nName=Dev OS Preview Test\nInherits=Adwaita\nDirectories=\n');
    const preferences = new ExtensionManager({system: `${ROOT}/src/apps`, components: `${ROOT}/src/system`, bundled: `${ROOT}/src/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const display = Gdk.Display.get_default()!, iconTheme = Gtk.IconTheme.get_for_screen(display.get_default_screen());
    const paths = iconTheme.get_search_path() ?? [];
    iconTheme.set_search_path([...paths, `${temporary}/icons`]);
    const gtk = Gtk.Settings.get_for_screen(display.get_default_screen()), original = gtk.gtk_icon_theme_name;
    let registered = false;
    const cleanup = icons.activate({display, preferences, onReload: () => () => {}, registerSettingsPage: () => {registered = true; return () => {};}});
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(760, 1500);
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(display.get_default_screen(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(container).find(widget => widget.name === id) as T;
    try {
        assert(registered && installedIconThemes(iconTheme).includes('DevOSPreviewTest'), 'Page registration and local theme discovery');
        root.render(<IconsSettings preferences={preferences} iconTheme={iconTheme} sessionTheme={original} />); window.show_all(); await wait();
        find<Gtk.Button>('icons-theme-DevOSPreviewTest').emit('clicked');
        find<Gtk.Switch>('icons-material-files').set_active(false); await wait();
        assert(gtk.gtk_icon_theme_name === 'Adwaita' && materialIcon('view.tsx') !== undefined, 'Preview leaves actual GTK theme and global Material flag unchanged');
        assert(find<Gtk.Label>('icons-preview-theme').get_text() === 'DevOSPreviewTest', 'Preview follows the selected theme');
        find<Gtk.Button>('icons-settings-apply').emit('clicked');
        assert(gtk.gtk_icon_theme_name === 'DevOSPreviewTest' && materialIcon('view.tsx') === undefined, 'Apply changes actual GTK theme and file icons');
        assert(materialIcon('view.tsx', false, true) !== undefined && materialIcon('view.tsx') === undefined, 'Preview overrides do not mutate global Material state');
        find<Gtk.Switch>('icons-material-files').set_active(true); find<Gtk.Button>('icons-settings-reset').emit('clicked');
        assert(!find<Gtk.Switch>('icons-material-files').active, 'Reset restores saved icon preferences');
        find<Gtk.SearchEntry>('icons-theme-search').set_text('DevOSPreview');
        assert(find('icons-theme-DevOSPreviewTest') && !find('icons-theme-Adwaita'), 'Search filters installed themes');
        find<Gtk.SearchEntry>('icons-theme-search').set_text(''); find<Gtk.Button>('icons-refresh').emit('clicked');
        find<Gtk.Switch>('icons-use-session').set_active(true); find<Gtk.Button>('icons-settings-apply').emit('clicked');
        assert(gtk.gtk_icon_theme_name === original, 'Session theme applies the original session choice');
        find<Gtk.Switch>('icons-material-files').set_active(true);
        find<Gtk.Button>('icons-pack-graphite').emit('clicked');
        assert(find<Gtk.Button>('icons-style-thin').has_focus || !find<Gtk.Button>('icons-style-solid').sensitive, 'Styles missing from a pack are disabled');
        assert(find<Gtk.Button>('icons-style-thin').sensitive && !find<Gtk.Button>('icons-style-regular').sensitive, 'Graphite offers only thin');
        find<Gtk.Button>('icons-settings-apply').emit('clicked');
        const saved = preferences.get('org.devos.icons').state.values;
        assert(saved.basePack === 'graphite' && saved.baseStyle === 'thin', 'Pack and style persist');
        find<Gtk.Button>('icons-pack-sharp-duotone').emit('clicked'); find<Gtk.Button>('icons-style-light').emit('clicked');
        find<Gtk.Button>('icons-settings-apply').emit('clicked');
        assert(preferences.get('org.devos.icons').state.values.basePack === 'sharp-duotone' && preferences.get('org.devos.icons').state.values.baseStyle === 'light', 'Changing pack and style applies');
        find<Gtk.Switch>('icons-base-enabled').set_active(false); find<Gtk.Button>('icons-settings-apply').emit('clicked');
        assert(preferences.get('org.devos.icons').state.values.baseIcons === false && !find<Gtk.Button>('icons-pack-classic').sensitive, 'Base icons can be turned off');
        find<Gtk.Switch>('icons-base-enabled').set_active(true);
        find<Gtk.Button>('icons-pack-classic').emit('clicked'); find<Gtk.Button>('icons-style-solid').emit('clicked');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (screenshot) {await wait(); window.get_pixbuf()!.savev(screenshot, 'png', [], []);}
        preferences.update('org.devos.icons', true, {themeName: 'missing-preview-theme', useSystemTheme: false});
        root.render(<IconsSettings key="missing" preferences={preferences} iconTheme={iconTheme} sessionTheme={original} />);
        assert(find<Gtk.Label>('icons-preview-theme').get_text() === original, 'Missing themes preview the real fallback');
        find<Gtk.Switch>('icons-material-files').set_active(true);
        assert(!find('icons-settings-apply').sensitive, 'Missing theme requires selecting an installed or session theme');
    } finally {
        root.unmount(); window.destroy(); cleanup(); iconTheme.set_search_path(paths); preferences.dispose();
        Gtk.StyleContext.remove_provider_for_screen(display.get_default_screen(), css);
        for (const relative of ['preferences/org.devos.icons.json', 'preferences', 'icons/DevOSPreviewTest/index.theme', 'icons/DevOSPreviewTest', 'icons', '']) {const file = Gio.File.new_for_path(`${temporary}/${relative}`); if (file.query_exists(null)) file.delete(null);}
    }
    print('PASS: icon discovery, isolated previews, actual GTK and Material application, search/refresh, session fallback and Reset');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
