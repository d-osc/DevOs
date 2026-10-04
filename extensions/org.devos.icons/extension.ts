import {Gtk, Gio} from '../../src/gtk.js';
import type {UIExtension, UIContext} from '../../src/extensions/runtime.js';
import {ROOT} from '../../src/config.js';
import {setMaterialIcons} from './material.js';

export function installedIconThemes(theme: Gtk.IconTheme): string[] {
    const names = new Set<string>();
    for (const path of theme.get_search_path() ?? []) {
        const directory = Gio.File.new_for_path(path);
        if (!directory.query_exists(null)) continue;
        let files: Gio.FileEnumerator;
        try { files = directory.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null); }
        catch { continue; }
        try {
            for (let file = files.next_file(null); file; file = files.next_file(null)) {
                if (directory.get_child(file.get_name()).get_child('index.theme').query_exists(null)) names.add(file.get_name());
            }
        } finally { files.close(null); }
    }
    return [...names].sort();
}

export default {id: 'org.devos.icons', activate(context: Pick<UIContext, 'display' | 'preferences' | 'onReload'>) {
    const screen = context.display.get_default_screen();
    const settings = Gtk.Settings.get_for_screen(screen);
    const theme = Gtk.IconTheme.get_for_screen(screen);
    const original = settings.gtk_icon_theme_name;
    const originalPaths = theme.get_search_path() ?? [];
    theme.prepend_search_path(`${ROOT}/data/icons`);
    const previousMaterial = setMaterialIcons(true);
    const apply = () => {
        const {values} = context.preferences.get('org.devos.icons').state;
        setMaterialIcons(values.materialFiles !== false);
        const requested = typeof values.themeName === 'string' ? values.themeName.trim() : '';
        const installed = installedIconThemes(theme);
        const selected = values.useSystemTheme === true || !installed.includes(requested) ? original : requested;
        if (values.useSystemTheme !== true && !installed.includes(requested))
            printerr(`Theme icons: ${requested || '(empty)'} is not installed; using ${original}`);
        if (settings.gtk_icon_theme_name !== selected) settings.gtk_icon_theme_name = selected;
    };
    apply();
    const unsubscribe = context.preferences.subscribe(apply);
    context.onReload(apply);
    return () => { unsubscribe(); setMaterialIcons(previousMaterial); theme.set_search_path(originalPaths); settings.gtk_icon_theme_name = original; };
}} satisfies UIExtension;
