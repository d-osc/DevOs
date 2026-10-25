import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
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
export class Keyboard implements KeyboardControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    request(action: KeyboardAction, ...args: string[]): Promise<KeyboardState> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Keyboard settings closed.')); return;}
            try {
                const local = `${ROOT}/bin/dev-os-keyboard`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-keyboard');
                if (!helper) throw new Error('Keyboard settings are not installed.');
                const child = Gio.Subprocess.new(['python3', helper, action, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 120, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(null, null, (_source, result) => {
                    if (timer) GLib.source_remove(timer); this.processes.delete(child);
                    try {const [, out, err] = child.communicate_utf8_finish(result); const response = JSON.parse(out || '{}'); if (!child.get_successful() || response.ok !== true) throw new Error(response.error || err || 'Keyboard settings failed.'); resolve(response as KeyboardState);} catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
