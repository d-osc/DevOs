import type {SettingsValues} from '@dev-os/core';
export function settingsOptions(values: SettingsValues = {}) {
    return {compactNavigation: values.compactNavigation === true, rememberPage: values.rememberPage === true, closeOnEscape: values.closeOnEscape !== false};
}
export function settingsStartPage(values: SettingsValues, lastPage: string, requested?: string) {
    return requested ?? (settingsOptions(values).rememberPage ? lastPage : 'system');
}
