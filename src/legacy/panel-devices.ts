import {Gio, GLib} from '@dev-os/core';
import {NativeModel} from './native-model.js';
import type {DeviceState} from './devices.js';
type Snapshot = Partial<DeviceState> & {audio: 'wpctl' | 'pactl' | null};
let model: NativeModel | undefined, timer = 0, signal = 0, current: Snapshot | undefined;
const listeners = new Set<(value: Snapshot) => void>();
const pending = new Set<() => void>();
const network = Gio.NetworkMonitor.get_default();
export function refreshPanelDevices(): Promise<void> {
    if (!model) return Promise.resolve();
    return new Promise(resolve => {
        let timeout = 0;
        const finish = () => {if (timeout) GLib.source_remove(timeout); timeout = 0; pending.delete(finish); resolve();};
        pending.add(finish);
        timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {timeout = 0; finish(); return GLib.SOURCE_REMOVE;});
        model!.submit({connected: network.get_network_available()});
    });
}
/** Shared read-only transport. Commands are never submitted to this replayed channel. */
export function subscribePanelDevices(changed: (value: Snapshot) => void): () => void {
    listeners.add(changed);
    if (!model) {
        model = new NativeModel('src/services/panel-devices.dev', frame => {if (frame.devices) {current = frame.devices as Snapshot; for (const listener of listeners) listener(current); for (const finish of [...pending]) finish();}});
        signal = network.connect('notify', () => {void refreshPanelDevices();});
        timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {refreshPanelDevices(); return GLib.SOURCE_CONTINUE;});
        refreshPanelDevices();
    }
    if (current) changed(current);
    return () => {listeners.delete(changed); if (!listeners.size) {network.disconnect(signal); signal = 0; GLib.source_remove(timer); timer = 0; model?.destroy(); model = undefined; current = undefined; for (const finish of [...pending]) finish();}};
}
