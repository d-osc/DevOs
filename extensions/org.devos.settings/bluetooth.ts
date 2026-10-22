import {Gio, GLib, Listeners} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {isWsl} from './wifi.js';

export interface BluetoothAdapter {id: string; name: string; powered: boolean;}
export interface BluetoothDevice {id: string; adapter: string; name: string; address: string; icon: string; paired: boolean; connected: boolean;}
export interface Peripheral {id: string; name: string; vendor: string;}
export type DevicePage = 'bluetooth' | 'mouse' | 'keyboard' | 'printers';
export interface BluetoothState {
    host: 'Windows' | 'Linux'; adapters: BluetoothAdapter[]; devices: BluetoothDevice[];
    usb: Peripheral[]; inputs: Peripheral[]; busy: boolean; error: string; bluetoothError: string;
}
export interface BluetoothControls {
    state: BluetoothState;
    subscribe(listener: () => void): () => void;
    refresh(scan?: boolean): Promise<void>;
    power(adapter: BluetoothAdapter): Promise<void>;
    device(action: 'connect' | 'disconnect' | 'forget', device: BluetoothDevice): Promise<void>;
    openSettings(page: DevicePage): Promise<void>;
}
export class Bluetooth implements BluetoothControls {
    state: BluetoothState = {host: isWsl() ? 'Windows' : 'Linux', adapters: [], devices: [], usb: [], inputs: [], busy: false, error: '', bluetoothError: ''};
    private listeners = new Listeners();
    private process: Gio.Subprocess | null = null;
    private disposed = false;
    subscribe(listener: () => void) { return this.listeners.subscribe(listener); }
    private update(next: Partial<BluetoothState>) {
        if (!this.disposed) { this.state = {...this.state, ...next}; this.listeners.emit(); }
    }
    private request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            try {
                // Source/staged layouts and installed-prefix layouts share this helper.
                const helper = GLib.file_test(`${ROOT}/bin/dev-os-devices-linux`, GLib.FileTest.IS_REGULAR)
                    ? `${ROOT}/bin/dev-os-devices-linux` : GLib.find_program_in_path('dev-os-devices-linux');
                if (!helper) throw new Error('Device settings helper is missing. Reinstall the current DevOs runtime.');
                const process = Gio.Subprocess.new(['d', helper], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                this.process = process;
                let timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => { timeout = 0; process.force_exit(); return GLib.SOURCE_REMOVE; });
                process.communicate_utf8_async(JSON.stringify(payload), null, (_source, result) => {
                    if (timeout) GLib.source_remove(timeout);
                    this.process = null;
                    try {
                        const [, stdout, stderr] = process.communicate_utf8_finish(result);
                        const response = JSON.parse(stdout || '{}') as Record<string, unknown>;
                        if (!process.get_successful() || response.ok !== true) throw new Error(String(response.error || stderr || 'Device request failed or timed out.'));
                        resolve(response);
                    } catch (error) { reject(error); }
                });
            } catch (error) { reject(error); }
        });
    }
    private async action(payload: Record<string, unknown>) {
        if (this.disposed || this.state.busy) return;
        this.update({busy: true, error: ''});
        try {
            const response = await this.request(payload);
            if (payload.action !== 'settings') {
                for (const key of ['adapters', 'devices', 'usb', 'inputs'])
                    if (!Array.isArray(response[key])) throw new Error('Invalid device list returned by the system.');
                this.update({adapters: response.adapters as BluetoothAdapter[], devices: response.devices as BluetoothDevice[],
                    usb: response.usb as Peripheral[], inputs: response.inputs as Peripheral[], bluetoothError: String(response.bluetoothError ?? '')});
            }
        } catch (error) { this.update({error: error instanceof Error ? error.message : String(error)}); }
        finally { this.update({busy: false}); }
    }
    refresh(scan = false) { return this.action({action: scan ? 'scan' : 'list'}); }
    power(adapter: BluetoothAdapter) { return this.action({action: 'power', id: adapter.id, powered: !adapter.powered}); }
    device(action: 'connect' | 'disconnect' | 'forget', device: BluetoothDevice) { return this.action({action, id: device.id}); }
    openSettings(page: DevicePage) { return this.action({action: 'settings', page}); }
    destroy() { this.disposed = true; this.process?.force_exit(); this.listeners.clear(); }
}
