import {themeSettings} from '@dev-os/core/theme';

/**
 * Upgrades saved extension state written by an older `settingsVersion`, so that a setting that was renamed or
 * removed never leaves the extension showing a validation error. Unknown extensions pass through untouched.
 */
export function migrateState(id: string, raw: unknown): unknown {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const state = raw as {version?: unknown; enabled?: unknown; values?: unknown};
    const values = state.values && typeof state.values === 'object' && !Array.isArray(state.values) ? state.values as Record<string, unknown> : {};
    if (id === 'org.devos.theme' && state.version === 1)
        // Graphite/Ocean/Plum and the custom accent are gone; see themeSettings for how they map to Auto/Dark.
        return {version: 2, enabled: state.enabled, values: {...themeSettings(values)}};
    if (id === 'org.devos.terminal' && state.version === 1) {
        // Terminal colors follow the Dark/Light theme; the Midnight/Slate/Paper scheme setting is dropped.
        const {scheme: _scheme, ...rest} = values;
        return {version: 2, enabled: state.enabled, values: rest};
    }
    return raw;
}
