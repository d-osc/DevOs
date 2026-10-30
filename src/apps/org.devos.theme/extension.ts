import {
    React, Gtk, GLib, type UIExtension, readText, resolveTheme, msUntilSwitch, setActiveTheme, themeStyle, type ThemeName, type ThemeFamily
} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {logindSleep} from '@dev-os/runtime/sleep';
import {themeOptions} from './options.js';
import {ThemeSettingsPage} from './settings-view.js';

/** Auto re-checks the clock at least this often, which also catches time-zone and clock changes cheaply. */
export const THEME_POLL_MS = 60000;

export default {id: 'org.devos.theme', activate(context) {
    let provider: Gtk.CssProvider | undefined, loaded = '', timer = 0, disposed = false, css = '';
    const screen = context.display.get_default_screen();
    const gtkSettings = Gtk.Settings.get_for_screen(screen), previousDark = gtkSettings.gtk_application_prefer_dark_theme;
    const readStyle = () => { css = readText(`${ROOT}/src/apps/org.devos.theme/style.css`); };
    const settings = () => themeOptions(context.preferences.get('org.devos.theme').state.values);
    /** Replaces the whole shell stylesheet; every open window restyles without a restart. */
    const render = (name: ThemeName, family: ThemeFamily) => {
        gtkSettings.gtk_application_prefer_dark_theme = name === 'dark';
        const style = themeStyle(css, name, family);
        if (style !== loaded) {
            const next = new Gtk.CssProvider();
            next.load_from_data(new TextEncoder().encode(style));
            if (provider) Gtk.StyleContext.remove_provider_for_screen(screen, provider);
            Gtk.StyleContext.add_provider_for_screen(screen, next, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            provider = next; loaded = style;
        }
        setActiveTheme(name, family);
        if (context.application?.get_application_id?.()?.startsWith('org.devos.Shell.')) {
            const runtime = GLib.getenv('XDG_RUNTIME_DIR');
            if (runtime) GLib.file_set_contents(`${runtime}/devos-native-theme.css`, new TextEncoder().encode(`/* devos-theme:${name} */\n${style}`));
        }
    };
    const arm = () => {
        if (timer) { GLib.source_remove(timer); timer = 0; }
        if (disposed) return;
        const current = settings(), wait = msUntilSwitch(current.mode, new Date(), current);
        if (wait === null) return; // Dark and Light never change by themselves.
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.min(wait + 50, THEME_POLL_MS), () => { timer = 0; update(); return GLib.SOURCE_REMOVE; });
    };
    const update = () => {
        const current = settings();
        render(resolveTheme(current.mode, new Date(), current), current.family); arm();
    };
    readStyle(); update();
    context.onReload(() => { readStyle(); update(); });
    const unsubscribe = context.preferences.subscribe(update);
    let stopSleep = () => {};
    try { stopSleep = logindSleep.watch(sleeping => { if (!sleeping) update(); }); } catch { /* No system bus (WSL, containers): the poll still covers resume. */ }
    context.registerSettingsPage?.('org.devos.theme', () => React.createElement(ThemeSettingsPage, {preferences: context.preferences}));
    return () => {
        disposed = true; if (timer) GLib.source_remove(timer);
        unsubscribe(); stopSleep();
        gtkSettings.gtk_application_prefer_dark_theme = previousDark;
        if (provider) Gtk.StyleContext.remove_provider_for_screen(screen, provider);
    };
}} satisfies UIExtension;
