import type {SettingsValues} from '@dev-os/core';
import {NativeModel} from './native-model.js';
export interface PanelMenuRow {key?: string; title?: string; icon?: string; custom?: boolean; separator?: boolean;}
let model: NativeModel | undefined, current: PanelMenuRow[] | undefined, source = '';
const listeners = new Set<(rows: PanelMenuRow[]) => void>();
/** Shared presentation transport. The worker owns filtering, labels and separators. */
export function subscribePanelMenu(values: SettingsValues, changed: (rows: PanelMenuRow[]) => void) {
    listeners.add(changed);
    if (!model) model = new NativeModel('src/services/panel-menu.dev', frame => {if (frame.rows) {current = frame.rows as PanelMenuRow[]; for (const listener of listeners) listener(current);}});
    const update = (next: SettingsValues) => {const encoded = JSON.stringify(next); if (encoded !== source) {source = encoded; current = undefined; model?.submit({values: next});} else if (current) changed(current);};
    update(values);
    return {update, destroy() {listeners.delete(changed); if (!listeners.size) {model?.destroy(); model = undefined; source = ''; current = undefined;}}};
}
