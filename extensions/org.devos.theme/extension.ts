import {
    React, Gtk, type UIExtension, readText
} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {themeStyle} from './options.js';
import {ThemeSettings} from './settings-view.js';

export default {id: 'org.devos.theme', activate(context) {
    let provider: Gtk.CssProvider | undefined;
    const screen = context.display.get_default_screen();
    let loaded = '';
    const load = () => {
        const style = themeStyle(readText(`${ROOT}/extensions/org.devos.theme/style.css`), context.preferences.get('org.devos.theme').state.values, context.config().accent);
        if (style === loaded) return;
        const next = new Gtk.CssProvider();
        next.load_from_data(new TextEncoder().encode(style));
        if (provider) Gtk.StyleContext.remove_provider_for_screen(screen, provider);
        Gtk.StyleContext.add_provider_for_screen(screen, next, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        provider = next;
        loaded = style;
    };
    load(); context.onReload(load);
    const unsubscribe = context.preferences.subscribe(load);
    context.registerSettingsPage?.('org.devos.theme', () => React.createElement(ThemeSettings, {preferences: context.preferences, getAccent: () => context.config().accent}));
    return () => { unsubscribe(); if (provider) Gtk.StyleContext.remove_provider_for_screen(screen, provider); };
}} satisfies UIExtension;
