import type {SettingsValues} from '@dev-os/core';

export interface PanelOptions {position: 'top' | 'bottom'; height: number; iconSize: number; spacing: number; itemSpacing: number; showPinned: boolean; showDate: boolean;}
export function panelOptions(values: SettingsValues = {}, desktopHeight = 36): PanelOptions {
    const number = (key: string, fallback: number, min: number, max: number) => typeof values[key] === 'number' && Number.isFinite(values[key])
        ? Math.max(min, Math.min(max, Math.round(values[key]))) : fallback;
    const fallbackHeight = Number.isFinite(desktopHeight) ? Math.max(32, Math.min(96, Math.round(desktopHeight))) : 36;
    return {position: values.position === 'top' ? 'top' : 'bottom',
        height: typeof values.height === 'number' && values.height >= 32 ? number('height', fallbackHeight, 32, 96) : fallbackHeight,
        iconSize: number('iconSize', 16, 14, 28), spacing: number('spacing', 12, 0, 32), itemSpacing: number('itemSpacing', 2, 0, 16),
        showPinned: values.showPinned !== false, showDate: values.showDate !== false};
}
