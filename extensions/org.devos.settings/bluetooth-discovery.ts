import {Gio, GLib} from '@dev-os/core';
export interface Discovery {scan<T>(adapter: string, read: () => Promise<T>): Promise<T>; destroy(): void;}
/** BlueZ discovery belongs to a D-Bus connection: keep that connection alive until read completes. */
export class BluetoothDiscovery implements Discovery {
    private timer = 0;
    private cancelWait?: () => void;
    private closed = false;
    constructor(private bus: Gio.DBusConnection = Gio.DBus.system, private duration = 10000) {}
    private call(adapter: string, method: string) {
        return new Promise<void>((resolve, reject) => this.bus.call('org.bluez', adapter,
            'org.bluez.Adapter1', method, null, null, Gio.DBusCallFlags.NONE, 5000, null,
            (bus, result) => {try {bus!.call_finish(result); resolve();} catch (error) {reject(error);}}));
    }
    async scan<T>(adapter: string, read: () => Promise<T>): Promise<T> {
        if (this.closed) throw new Error('Bluetooth settings closed.');
        let owned = false;
        try {
            try {await this.call(adapter, 'StartDiscovery'); owned = true;}
            // Same-connection InProgress means a scan is already running: wait and read its results instead of failing.
            catch (error) {if (!/InProgress/.test(String(error))) throw error;}
            if (this.closed) throw new Error('Bluetooth settings closed.');
            await new Promise<void>((resolve, reject) => {
                this.cancelWait = () => reject(new Error('Bluetooth scan cancelled.'));
                this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.duration, () => {
                    this.timer = 0; this.cancelWait = undefined; resolve(); return GLib.SOURCE_REMOVE;
                });
            });
            return await read();
        } finally {
            if (this.timer) GLib.source_remove(this.timer);
            this.timer = 0; this.cancelWait = undefined;
            if (owned) {try {await this.call(adapter, 'StopDiscovery');} catch { /* Adapter may have been removed. */ }}
        }
    }
    destroy() {this.closed = true; this.cancelWait?.();}
}
