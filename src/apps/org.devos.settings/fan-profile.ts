import {serviceClass} from '@dev-os/runtime/app-service';
import {HelperClient} from './helper-client.js';
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
export type FanProfile = import('./fan-profile.backend.js').FanProfile;
export const FanProfile = serviceClass<typeof import('./fan-profile.backend.js').FanProfile>('settings/fan-profile.FanProfile', {}, []);
