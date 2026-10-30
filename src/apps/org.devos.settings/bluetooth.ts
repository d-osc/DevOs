import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib, Listeners} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {BluetoothAgent, type PairPrompt} from './bluetooth-agent.js';
import {BluetoothDiscovery, type Discovery} from './bluetooth-discovery.js';
import {isWsl} from './wifi.js';

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
export type Bluetooth = import('./bluetooth.backend.js').Bluetooth;
export const Bluetooth = serviceClass<typeof import('./bluetooth.backend.js').Bluetooth>('settings/bluetooth.Bluetooth', {state: {host: isWsl() ? 'Windows' : 'Linux', adapters: [], devices: [], usb: [], inputs: [], busy: false, error: '', bluetoothError: ''}}, ["respond","cancelPair"]);
