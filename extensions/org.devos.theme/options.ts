import {resolveTheme, themeSettings, type SettingsValues, type ThemeName, type ThemeSettings} from '@dev-os/core';

/** The saved Theme values, validated; anything unrecognised (including pre-Dark/Light settings) becomes Auto. */
export const themeOptions = (values: SettingsValues = {}): ThemeSettings => themeSettings(values);

/** The theme to show for saved values at a moment. */
export const themeFor = (values: SettingsValues, now: Date = new Date()): ThemeName => {
    const settings = themeOptions(values);
    return resolveTheme(settings.mode, now, settings);
};
