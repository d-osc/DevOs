import type {SettingsValues, WindowControls} from '@dev-os/core';

export const widgetKeys = ['widgetClock', 'widgetDate', 'widgetNote', 'widgetNoteText', 'widgetPosition', 'widgetLocations'] as const;
export interface WidgetDesktop {key: string; name: string; first: boolean; firstKey: string;}
export function activeWidgetDesktop(controls?: WindowControls): WidgetDesktop | null {
    if (!controls) return {key: 'default', name: 'Desktop', first: true, firstKey: 'default'};
    const desktops = controls.desktops ?? [], active = desktops.find(desktop => desktop.active);
    if (!active) return null;
    // Names survive ordinal renumbering when an earlier desktop is removed.
    const duplicate = desktops.slice(0, desktops.indexOf(active)).filter(desktop => desktop.name === active.name).length;
    return {key: JSON.stringify([active.name, duplicate]), name: active.name, first: desktops[0] === active, firstKey: JSON.stringify([desktops[0].name, 0])};
}
export function widgetDesktopMap(values: SettingsValues): Record<string, SettingsValues> {
    try {
        const parsed = JSON.parse(String(values.widgetDesktops ?? '{}'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))) as Record<string, SettingsValues>;
        }
    } catch { /* Keep a malformed preference readable through safe defaults. */ }
    return {};
}
export function desktopWidgetValues(values: SettingsValues, desktop: WidgetDesktop | null): SettingsValues {
    const empty: SettingsValues = {widgetClock: false, widgetDate: false, widgetNote: false, widgetNoteText: '', widgetPosition: 'right', widgetLocations: '{}'};
    if (!desktop) return empty;
    const stored = widgetDesktopMap(values)[desktop.key];
    // Existing global widgets are inherited once by the first desktop only.
    const source = stored ?? (desktop.first && values.widgetDesktopVersion !== 1 ? values : {});
    return {...empty, ...Object.fromEntries(widgetKeys.filter(key => source[key] !== undefined).map(key => [key, source[key]]))};
}
export function updateDesktopWidgets(values: SettingsValues, desktop: WidgetDesktop, patch: SettingsValues): SettingsValues {
    if (desktop.key === 'default') return {...values, ...patch};
    const initialized = initializeDesktopWidgets(values, desktop);
    const map = widgetDesktopMap(initialized);
    map[desktop.key] = {...desktopWidgetValues(initialized, desktop), ...patch};
    return {...initialized, widgetDesktops: JSON.stringify(map)};
}
export function initializeDesktopWidgets(values: SettingsValues, desktop: WidgetDesktop): SettingsValues {
    if (desktop.key === 'default' || values.widgetDesktopVersion === 1) return values;
    const map = widgetDesktopMap(values);
    map[desktop.firstKey] ??= desktopWidgetValues(values, {...desktop, key: desktop.firstKey, first: true});
    return {...values, widgetDesktops: JSON.stringify(map), widgetDesktopVersion: 1};
}
