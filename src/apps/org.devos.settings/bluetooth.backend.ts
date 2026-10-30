import {Gio, GLib, Listeners} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
import {BluetoothAgent, type PairPrompt} from './bluetooth-agent.js';
import {BluetoothDiscovery, type Discovery} from './bluetooth-discovery.js';
import {isWsl} from './wifi.backend.js';

export interface BluetoothAdapter {id: string; name: string; powered: boolean;}
export interface BluetoothDevice {id: string; adapter: string; name: string; named?: boolean; address: string; icon: string; paired: boolean; connected: boolean;}
export interface Peripheral {id: string; name: string; vendor: string;}
export type DevicePage = 'bluetooth-add' | 'mouse' | 'keyboard' | 'printers';
export interface BluetoothState {
    prompt?: PairPrompt | null; pairing?: string;
    host: 'Windows' | 'Linux'; adapters: BluetoothAdapter[]; devices: BluetoothDevice[];
    usb: Peripheral[]; inputs: Peripheral[]; busy: boolean; scanning?: boolean; error: string; bluetoothError: string;
}
export interface BluetoothControls {
    state: BluetoothState;
    subscribe(listener: () => void): () => void;
    refresh(scan?: boolean): Promise<void>;
    power(adapter: BluetoothAdapter): Promise<void>;
    device(action: 'connect' | 'disconnect' | 'forget', device: BluetoothDevice): Promise<void>;
    openSettings(page: DevicePage): Promise<void>;
    pair?(device: BluetoothDevice): Promise<void>;
    respond?(accept: boolean, value?: string): void;
    cancelPair?(): void;
}
export class Bluetooth implements BluetoothControls {
    state: BluetoothState = {host: isWsl() ? 'Windows' : 'Linux', adapters: [], devices: [], usb: [], inputs: [], busy: false, error: '', bluetoothError: ''};
    private agent = new BluetoothAgent(prompt => this.update({prompt}));
    private listeners = new Listeners();
    private process: Gio.Subprocess | null = null;
    private disposed = false;
    constructor(private discovery: Discovery = new BluetoothDiscovery()) {}
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
    private async action(payload: Record<string, unknown>, scan = false) {
        if (this.disposed || this.state.busy) return;
        this.update({busy: true, scanning: scan, error: ''});
        try {
            const adapter = this.state.adapters.find(item => item.powered);
            if (scan && !adapter) throw new Error('Turn on a Bluetooth adapter before scanning.');
            const response = scan
                ? await this.discovery.scan(adapter!.id, () => this.request({action:'get'}))
                : await this.request(payload);
            if (payload.action !== 'settings') {
                const state = response.state as Record<string, unknown> | undefined;
                if (!state) throw new Error('Device settings helper returned no state.');
                for (const key of ['adapters', 'devices', 'usb', 'inputs'])
                    if (!Array.isArray(state[key])) throw new Error('Invalid device list returned by the system.');
                this.update({adapters: state.adapters as BluetoothAdapter[], devices: state.devices as BluetoothDevice[],
                    usb: state.usb as Peripheral[], inputs: state.inputs as Peripheral[], bluetoothError: String(state.bluetoothError ?? '')});
                // Recorded in the shell log (root-session.log) so a boot shows what the page itself saw.
                if (scan) printerr(`Bluetooth UI: scan finished, ${this.state.devices.length} device(s) listed, ${this.state.devices.filter(d => d.named !== false).length} named`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (scan || payload.action !== 'get') printerr(`Bluetooth UI: ${String(payload.action)}${scan ? ' (scan)' : ''} failed: ${message}`);
            this.update({error: message});
        }
        finally { this.update({busy: false, scanning: false}); }
    }
    refresh(scan = false) { return this.action({action: 'get'}, scan); }
    power(adapter: BluetoothAdapter) { return this.action({action: 'power', id: adapter.id, powered: !adapter.powered}); }
    device(action: 'connect' | 'disconnect' | 'forget', device: BluetoothDevice) { return this.action({action, id: device.id}); }
    openSettings(page: DevicePage) { return this.action({action: 'settings', page}); }
    async pair(device: BluetoothDevice) {
        if (this.disposed || this.state.busy || !this.state.devices.some(d => d.id === device.id && !d.paired)) return;
        this.update({busy: true, error: '', pairing: device.name});
        let failure = '';
        try {await this.agent.pair(device.id);} catch (error) {failure = String(error);}
        finally {this.update({busy: false, pairing: '', prompt: null}); if (!this.disposed) await this.refresh(); if (failure) this.update({error: failure});}
    }
    respond(accept: boolean, value = '') {try {this.agent.respond(accept, value);} catch (error) {this.update({error: String(error)});}}
    cancelPair() {this.agent.cancel();}
    destroy() {this.discovery.destroy(); this.agent.cancel(); this.disposed = true; this.process?.force_exit(); this.listeners.clear(); }
}
