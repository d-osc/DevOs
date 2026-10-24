import {
    React, Gtk, type UIExtension, type UIContext, setBaseIconProvider
} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {setMaterialIcons} from './material.js';
import {installedIconThemes} from './themes.js';
import {renderIcon, savedChoice} from './fa-icons.js';
export {installedIconThemes} from './themes.js';
import {IconsSettings} from './settings-view.js';

export default {id: 'org.devos.icons', activate(context: Pick<UIContext, 'display' | 'preferences' | 'onReload' | 'registerSettingsPage'>) {
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
        const choice = savedChoice(values.basePack, values.baseStyle);
        setBaseIconProvider(values.baseIcons === false ? undefined : (name, size, color) => renderIcon(name, size, color, choice));
        const requested = typeof values.themeName === 'string' ? values.themeName.trim() : '';
        const installed = installedIconThemes(theme);
        const selected = values.useSystemTheme === true || !installed.includes(requested) ? original : requested;
        if (values.useSystemTheme !== true && !installed.includes(requested))
            printerr(`Theme icons: ${requested || '(empty)'} is not installed; using ${original}`);
        if (settings.gtk_icon_theme_name !== selected) settings.gtk_icon_theme_name = selected;
    };
    context.registerSettingsPage?.('org.devos.icons', () => React.createElement(IconsSettings, {preferences: context.preferences, iconTheme: theme, sessionTheme: original}));
    apply();
    const unsubscribe = context.preferences.subscribe(apply);
    context.onReload(apply);
    return () => { unsubscribe(); setBaseIconProvider(undefined); setMaterialIcons(previousMaterial); theme.set_search_path(originalPaths); settings.gtk_icon_theme_name = original; };
}} satisfies UIExtension;
