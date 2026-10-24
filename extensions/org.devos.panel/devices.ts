import {isWsl} from '../org.devos.settings/wifi.js';
import {readPower, type BatteryStatus, type PowerFs} from './battery.js';
import {
    Listeners, Gio, GLib
} from '@dev-os/core';

export interface DeviceState {
    connected: boolean; wireless: boolean; network: string;
    wifi: boolean | null; bluetooth: boolean | null;
    brightness?: number | null; volume: number | null; muted: boolean; battery: number | null;
    batteryStatus?: BatteryStatus;
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
function entries(path: string): string[] {
    try {
        const files = Gio.File.new_for_path(path).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        const names: string[] = [];
        try { for (let file = files.next_file(null); file; file = files.next_file(null)) names.push(file.get_name()); }
        finally { files.close(null); }
        return names;
    } catch { return []; }
}
function text(path: string): string {
    try { return new TextDecoder().decode(GLib.file_get_contents(path)[1]).trim(); } catch { return ''; }
}
const sysfs: PowerFs = {list: entries, read: text};
export class Devices implements DeviceControls {
    private batteryTimer: number;
    private readBattery() {
        const {battery, batteryStatus, batteryFound, acOnline, acFound} = readPower(sysfs);
        const s = this.state;
        if (s.battery === battery && s.batteryStatus === batteryStatus && s.batteryFound === batteryFound && s.acOnline === acOnline && s.acFound === acFound) return;
        this.update({battery, batteryStatus, batteryFound, acOnline, acFound});
    }
    state: DeviceState = {connected: false, wireless: false, network: 'Checking network…', wifi: null,
        bluetooth: null, volume: null, muted: false, battery: null, busy: false, error: ''};
    private listeners = new Listeners();
    private cancel = new Gio.Cancellable();
    private processes = new Set<Gio.Subprocess>();
    private network = Gio.NetworkMonitor.get_default();
    private networkSignal: number;
    private timer: number;
    private disposed = false;
    private refreshing = false;
    private audio: 'wpctl' | 'pactl' | null = null;
    constructor() {
        this.batteryTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {this.readBattery(); return GLib.SOURCE_CONTINUE;});
        this.networkSignal = this.network.connect('notify', () => { void this.refresh(); });
        // Each refresh starts nmcli, bluetoothctl and pactl; polling every 5 s kept slow machines and emulators busy.
        // Actions and network changes still refresh immediately.
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => { void this.refresh(); return GLib.SOURCE_CONTINUE; });
        void this.refresh();
    }
    subscribe(listener: () => void) { return this.listeners.subscribe(listener); }
    private update(next: Partial<DeviceState>) {
        if (this.disposed) return;
        this.state = {...this.state, ...next};
        this.listeners.emit();
    }
    private run(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            if (this.disposed) { reject(new Error('Devices disposed')); return; }
            let process: Gio.Subprocess;
            try {
                const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
                launcher.setenv('LC_ALL', 'C', true);
                process = launcher.spawnv(args);
            } catch (error) { reject(error); return; }
            this.processes.add(process);
            let timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
                timeout = 0; process.force_exit(); return GLib.SOURCE_REMOVE;
            });
            process.communicate_utf8_async(null, this.cancel, (_source, result) => {
                if (timeout) GLib.source_remove(timeout);
                this.processes.delete(process);
                try {
                    const [, stdout, stderr] = process.communicate_utf8_finish(result);
                    if (!process.get_successful()) throw new Error(stderr?.trim() || `${args[0]} is unavailable`);
                    resolve(stdout?.trim() ?? '');
                } catch (error) { reject(error); }
            });
        });
    }
    private async refresh() {
        if (this.disposed || this.refreshing) return;
        this.refreshing = true;
        try {
            const wirelessAdapter = entries('/sys/class/net').some(name => GLib.file_test(`/sys/class/net/${name}/wireless`, GLib.FileTest.IS_DIR));
            const route = text('/proc/net/route').split('\n').map(line => line.trim().split(/\s+/)).find(fields => fields[1] === '00000000')?.[0];
            const wireless = route ? GLib.file_test(`/sys/class/net/${route}/wireless`, GLib.FileTest.IS_DIR) : wirelessAdapter;
            this.readBattery();
            const connected = this.network.get_network_available();
            this.update({connected, wireless, network: connected ? isWsl() ? 'Connected through Windows' : wireless ? 'Wi-Fi connected' : 'Ethernet connected' : 'No network connection',
                });
            const backlight = entries('/sys/class/backlight').sort().find(name => Number(text(`/sys/class/backlight/${name}/max_brightness`)) > 0);
            const maximum = backlight ? Number(text(`/sys/class/backlight/${backlight}/max_brightness`)) : 0;
            const brightnessText = backlight ? text(`/sys/class/backlight/${backlight}/brightness`) : '';
            const brightness = Number(brightnessText);
            this.update({brightness: brightnessText && maximum > 0 && Number.isFinite(brightness) ? Math.round(brightness / maximum * 100) : null});
            const reads: Promise<void>[] = [this.readAudio()];
            if (wirelessAdapter && GLib.find_program_in_path('nmcli')) reads.push(this.run(['nmcli', 'radio', 'wifi']).then(value => { this.update({wifi: value === 'enabled'}); }).catch(() => { this.update({wifi: null}); }));
            if (GLib.find_program_in_path('bluetoothctl')) reads.push(this.run(['bluetoothctl', 'show']).then(value => { this.update({bluetooth: /Powered: (yes|no)/.test(value) ? /Powered: yes/.test(value) : null}); }).catch(() => { this.update({bluetooth: null}); }));
            await Promise.all(reads);
        } finally { this.refreshing = false; }
    }
    private async readAudio() {
        if (GLib.find_program_in_path('wpctl')) {
            try {
                const value = await this.run(['wpctl', 'get-volume', '@DEFAULT_AUDIO_SINK@']);
                const match = value.match(/Volume:\s*([\d.]+)/);
                if (!match) throw new Error('No audio output');
                this.audio = 'wpctl'; this.update({volume: Math.round(Number(match[1]) * 100), muted: value.includes('[MUTED]')}); return;
            } catch { /* PulseAudio is also used by WSLg. */ }
        }
        if (GLib.find_program_in_path('pactl')) {
            try {
                const [volume, mute] = await Promise.all([this.run(['pactl', 'get-sink-volume', '@DEFAULT_SINK@']), this.run(['pactl', 'get-sink-mute', '@DEFAULT_SINK@'])]);
                const match = volume.match(/(\d+)%/);
                if (!match) throw new Error('No audio output');
                this.audio = 'pactl'; this.update({volume: Number(match[1]), muted: mute.endsWith('yes')}); return;
            } catch { /* Display unavailable, never a made-up volume level. */ }
        }
        this.audio = null; this.update({volume: null, muted: false});
    }
    private async action(args: string[]) {
        if (this.state.busy || this.disposed) return;
        this.update({busy: true, error: ''});
        try { await this.run(args); await this.readAudio(); await this.refresh(); }
        catch (error) { this.update({error: error instanceof Error ? error.message : String(error)}); }
        finally { this.update({busy: false}); }
    }
    setBrightness(value: number) {
        if (this.state.brightness == null) return Promise.resolve();
        return this.action(['dev-os-backlight', '--', 'set', String(Math.max(1,Math.min(100,Math.round(value))))]);
    }
    setVolume(value: number) {
        if (!this.audio) return Promise.resolve();
        const percent = `${Math.max(0, Math.min(100, Math.round(value)))}%`;
        return this.action(this.audio === 'wpctl' ? ['wpctl', 'set-volume', '@DEFAULT_AUDIO_SINK@', percent] : ['pactl', 'set-sink-volume', '@DEFAULT_SINK@', percent]);
    }
    toggleMute() {
        if (!this.audio) return Promise.resolve();
        return this.action(this.audio === 'wpctl' ? ['wpctl', 'set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle'] : ['pactl', 'set-sink-mute', '@DEFAULT_SINK@', 'toggle']);
    }
    toggleWifi() { return this.state.wifi === null ? Promise.resolve() : this.action(['nmcli', 'radio', 'wifi', this.state.wifi ? 'off' : 'on']); }
    toggleBluetooth() { return this.state.bluetooth === null ? Promise.resolve() : this.action(['bluetoothctl', 'power', this.state.bluetooth ? 'off' : 'on']); }
    destroy() {
        this.disposed = true;
        GLib.source_remove(this.batteryTimer);
        GLib.source_remove(this.timer); this.network.disconnect(this.networkSignal);
        this.cancel.cancel(); for (const process of this.processes) process.force_exit(); this.listeners.clear();
    }
}
