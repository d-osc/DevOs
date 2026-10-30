import {serviceClass} from '@dev-os/runtime/app-service';
import {HelperClient} from './helper-client.js';
export type FnMode = 'locked' | 'normal';
export type SleepMode = 'nothing' | 'both' | 'battery';
export interface KeyboardPreferences {autoBrighten: boolean; autoDim: boolean; sleep: SleepMode; sleepBoth: number; sleepBattery: number;}
interface Support {supported: boolean; reason: string;}
/** Result of `dev-os-keyboard get`: what the hardware offers (each part with a reason when it does not) and the saved preferences. */
export interface KeyboardState {
    settings: KeyboardPreferences; timeouts: number[];
    fn: Support & {mode: FnMode | ''};
    backlight: Support & {name: string; max: number; level: number};
    sensor: Support & {lux: number | null};
    idle: Support;
    mains: boolean | null;
}
export type KeyboardAction = 'get' | 'set';
export interface KeyboardControls {request(action: KeyboardAction, ...args: string[]): Promise<KeyboardState>; destroy(): void;}
export const unsupportedKeyboard: KeyboardState = {
    settings: {autoBrighten: false, autoDim: false, sleep: 'nothing', sleepBoth: 60, sleepBattery: 60}, timeouts: [10, 30, 60, 120, 300, 600],
    fn: {supported: false, reason: '', mode: ''}, backlight: {supported: false, reason: '', name: '', max: 0, level: 0},
    sensor: {supported: false, reason: '', lux: null}, idle: {supported: false, reason: ''}, mains: null,
};
export const fnModes: Record<FnMode, {title: string; description: string}> = {
    locked: {title: 'Locked Fn key', description: 'Press F1-F12 to initiate the specified hotkey function.'},
    normal: {title: 'Normal Fn key', description: 'Press F1-F12 to initiate the F1-F12 function defined by your system or a specific app.'},
};
export const sleepModes: Record<SleepMode, {title: string; description: string}> = {
    nothing: {title: 'Do nothing', description: 'Keep the keyboard backlight always on'},
    both: {title: 'While on battery or on AC power', description: 'Select the idle time before the keyboard backlight turns off while on battery or AC power'},
    battery: {title: 'While on battery power only', description: 'Select the idle time before the keyboard backlight turns off while on battery power'},
};
export const timeoutTitle = (seconds: number) => seconds < 60 ? `${seconds} Second(s)` : `${seconds / 60} Minute(s)`;
export type Keyboard = import('./keyboard.backend.js').Keyboard;
export const Keyboard = serviceClass<typeof import('./keyboard.backend.js').Keyboard>('settings/keyboard.Keyboard', {}, []);
