import {GLib} from '@dev-os/core';
import {NativeModel} from './native-model.js';
import type {PowerReading, batteryPresentation} from './panel-legacy/battery.js';

export type PanelPower = PowerReading & {batteryPresentation: ReturnType<typeof batteryPresentation>};
let model: NativeModel | undefined, timer = 0, current: PanelPower | undefined, encoded = '';
const listeners = new Set<(value: PanelPower) => void>();

/** One read-only DevLang worker shared by all panel monitors in this shell. */
export function subscribePanelPower(changed: (value: PanelPower) => void): () => void {
    listeners.add(changed);
    if (!model) {
        model = new NativeModel('src/services/panel-power.dev', frame => {
            if (!frame.power) return;
            const next = JSON.stringify(frame.power);
            if (next === encoded) return;
            encoded = next; current = frame.power as PanelPower;
            for (const listener of listeners) listener(current);
        });
        model.submit({});
        timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {model?.submit({}); return GLib.SOURCE_CONTINUE;});
    }
    if (current) changed(current);
    return () => {
        listeners.delete(changed);
        if (!listeners.size) {if (timer) GLib.source_remove(timer); timer = 0; model?.destroy(); model = undefined; current = undefined; encoded = '';}
    };
}
