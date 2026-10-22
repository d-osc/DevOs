import type {SettingsValues} from '@dev-os/core';
export const themePalettes = {
    graphite: {title: 'Graphite', detail: 'Classic charcoal', surface: '#1c212b', sidebar: '#171c24', card: '#242c39', border: '#394454'},
    ocean: {title: 'Ocean', detail: 'Deep blue tones', surface: '#172b36', sidebar: '#12232d', card: '#203b48', border: '#365363'},
    plum: {title: 'Plum', detail: 'Soft violet tones', surface: '#292333', sidebar: '#201b2a', card: '#362d43', border: '#534460'},
};
export const accentChoices = ['#88e0c0', '#8ab4f8', '#c4a0f5', '#f1b98a', '#ed9db7'];
export function themeOptions(values: SettingsValues = {}) {
    return {palette: Object.hasOwn(themePalettes, String(values.palette)) ? String(values.palette) as keyof typeof themePalettes : 'graphite',
        useDesktopAccent: values.useDesktopAccent !== false, accent: typeof values.accent === 'string' && /^#[0-9a-f]{6}$/i.test(values.accent) ? values.accent : '#88e0c0'};
}
export function themeAccent(values: SettingsValues, desktopAccent: string) {
    const options = themeOptions(values);
    return options.useDesktopAccent && /^#[0-9a-f]{6}$/i.test(desktopAccent) ? desktopAccent : options.accent;
}
export function themeStyle(source: string, values: SettingsValues, desktopAccent: string) {
    const options = themeOptions(values), palette = themePalettes[options.palette];
    const base = source.replaceAll('@ACCENT@', themeAccent(values, desktopAccent));
    if (options.palette === 'graphite') return base;
    return `${base}\n
window#settings, window#files, window#editor, window#updates, window#store { background: ${palette.surface}; }
#settings .settings-sidebar, #files .files-sidebar, #launcher .launcher-footer { background: ${palette.sidebar}; border-color: ${palette.border}; }
#settings .settings-card, #settings button.settings-nav:hover, #files .files-toolbar { background: ${palette.card}; border-color: ${palette.border}; }
window#panel, #settings .panel-preview-bar, .panel-popup, .panel-popup > contents, .app-titlebar,
#settings .app-titlebar, #files .app-titlebar, #terminal .app-titlebar, #editor .app-titlebar { background: ${palette.sidebar}; border-color: ${palette.border}; }
window#launcher { background: ${palette.surface}; border-color: ${palette.border}; }
`;
}
