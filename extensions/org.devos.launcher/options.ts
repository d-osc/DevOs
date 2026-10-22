import type {SettingsValues} from '@dev-os/core';

export interface LauncherOptions {menuWidth: number; iconSize: number; compactRows: boolean; showWorkspace: boolean; showDescriptions: boolean; rememberSearch: boolean;}
export const DEFAULT_LAUNCHER_OPTIONS: Readonly<LauncherOptions> = Object.freeze({
    menuWidth: 600, iconSize: 28, compactRows: false, showWorkspace: true, showDescriptions: true, rememberSearch: false,
});
export function launcherOptions(values: SettingsValues = {}): LauncherOptions {
    const number = (key: 'menuWidth' | 'iconSize', min: number, max: number) => typeof values[key] === 'number' && Number.isFinite(values[key])
        ? Math.max(min, Math.min(max, Math.round(values[key]))) : DEFAULT_LAUNCHER_OPTIONS[key];
    return {menuWidth: number('menuWidth', 420, 900), iconSize: number('iconSize', 20, 40),
        compactRows: values.compactRows === true, showWorkspace: values.showWorkspace !== false,
        showDescriptions: values.showDescriptions !== false, rememberSearch: values.rememberSearch === true};
}
