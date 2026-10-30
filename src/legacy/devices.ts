import {subscribePanelDevices, refreshPanelDevices} from './panel-devices.js';
import type {BatteryStatus, batteryPresentation} from './battery.js';
import {subscribePanelPower} from './panel-power.js';
import {NativeAction} from './native-action.js';
import {
    Listeners
} from '@dev-os/core';

export interface DeviceState {
    connected: boolean; wireless: boolean; network: string;
    wifi: boolean | null; bluetooth: boolean | null;
    brightness?: number | null; volume: number | null; muted: boolean; battery: number | null;
    batteryStatus?: BatteryStatus;
    batteryPresentation?: ReturnType<typeof batteryPresentation>;
    /** Whether /sys/class/power_supply has a battery, and whether a charger or any other supply is online. */
    batteryFound?: boolean; acOnline?: boolean; acFound?: boolean;
    busy: boolean; error: string;
}
export interface DeviceControls {
    state: DeviceState;
    subscribe(listener: () => void): () => void;
    setBrightness?(value: number): Promise<void>;
    setVolume(value: number): Promise<void>;
    toggleMute(): Promise<void>;
    toggleWifi(): Promise<void>;
    toggleBluetooth(): Promise<void>;
}
export class Devices implements DeviceControls {
    private powerCleanup: () => void;
    state: DeviceState = {connected: false, wireless: false, network: 'Checking network…', wifi: null,
        bluetooth: null, volume: null, muted: false, battery: null, busy: false, error: ''};
    private listeners = new Listeners();
    private actions = new NativeAction('src/services/panel-device-action.dev');
    private disposed = false;
    private deviceCleanup: () => void;
    constructor() {
        this.powerCleanup = subscribePanelPower(value => this.update(value));
        this.deviceCleanup = subscribePanelDevices(value => this.update(value));
    }
    subscribe(listener: () => void) { return this.listeners.subscribe(listener); }
    private update(next: Partial<DeviceState>) {
        if (this.disposed) return;
        this.state = {...this.state, ...next};
        this.listeners.emit();
    }
    private refresh() {return refreshPanelDevices();}
    private async action(action: string, value?: number) {
        if (this.state.busy || this.disposed) return;
        this.update({busy: true, error: ''});
        try { await this.actions.run({action, value}); await this.refresh(); }
        catch (error) { this.update({error: error instanceof Error ? error.message : String(error)}); }
        finally { this.update({busy: false}); }
    }
    setBrightness(value: number) {
        return this.action('brightness', value);
    }
    setVolume(value: number) {
        return this.action('volume', value);
    }
    toggleMute() {
        return this.action('mute');
    }
    toggleWifi() {return this.action('wifi');}
    toggleBluetooth() {return this.action('bluetooth');}
    destroy() {
        this.disposed = true;
        this.powerCleanup();
        this.deviceCleanup();
        this.actions.destroy(); this.listeners.clear();
    }
}
