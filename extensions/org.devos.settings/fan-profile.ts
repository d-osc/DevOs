import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export type FanMode = 'performance' | 'standard' | 'whisper';
export type PowerSource = 'ac' | 'battery';
/** Result of `dev-os-fan-profile get`: which kernel interface backs the profile and what is saved per power source. */
export interface FanProfileState {
    supported: boolean; reason: string;
    /** platform_profile, asus_wmi or cpufreq; empty when nothing is available. */
    backend: string;
    /** cpufreq only: the CPU policy stands in for the fan profile (the fan keeps following the temperature). */
    emulated: boolean;
    modes: FanMode[]; current: FanMode | '';
    source: PowerSource | 'unknown';
    /** Saved profile per power source, empty when never chosen. */
    ac: FanMode | ''; battery: FanMode | '';
    sync: boolean; syncAvailable: boolean;
    /** The Fn + F hotkey is handled by the asus-wmi driver. */
    hotkey: boolean; rpm: number | null;
}
export type FanProfileAction = 'get' | 'set' | 'sync';
export interface FanProfileControls {request(action: FanProfileAction, ...args: string[]): Promise<FanProfileState>; destroy(): void;}
export const unsupportedFanProfile: FanProfileState = {supported: false, reason: '', backend: '', emulated: false, modes: [], current: '', source: 'unknown', ac: '', battery: '', sync: true, syncAvailable: false, hotkey: false, rpm: null};
export const fanModes: Record<FanMode, {title: string; description: string}> = {
    performance: {title: 'Performance mode', description: 'Dynamically maximizes cooling performance for demanding tasks.'},
    standard: {title: 'Standard mode', description: 'Dynamically selects the best fan speed for everyday tasks.'},
    whisper: {title: 'Whisper mode', description: 'Dynamically minimizes fan speed for the quietest operation.'},
};
export const sourceTitles: Record<PowerSource, string> = {ac: 'Plugged-in', battery: 'On battery'};
export class FanProfile implements FanProfileControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    request(action: FanProfileAction, ...args: string[]): Promise<FanProfileState> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Fan profile settings closed.')); return;}
            try {
                const local = `${ROOT}/bin/dev-os-fan-profile`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-fan-profile');
                if (!helper) throw new Error('Fan profiles are not installed.');
                const child = Gio.Subprocess.new(['sh', helper, action, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 120, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(null, null, (_source, result) => {
                    if (timer) GLib.source_remove(timer); this.processes.delete(child);
                    try {const [, out, err] = child.communicate_utf8_finish(result); const response = JSON.parse(out || '{}'); if (!child.get_successful() || response.ok !== true) throw new Error(response.error || err || 'Fan profile settings failed.'); resolve(response as FanProfileState);} catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
