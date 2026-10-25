import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {defaultCare, type CareSettings} from '../org.devos.displaycare/care.js';
export type {CareSettings, Splendid} from '../org.devos.displaycare/care.js';
export interface Capability {available: boolean; reason: string;}
/** Result of `dev-os-display-care get`: the saved values and what this session's compositor can really do. */
export interface DisplayCareState {
    settings: CareSettings;
    /** wlr-gamma-control: carries Splendid and Flicker-Free Dimming. */
    gamma: Capability;
    /** ext-idle-notify: starts Pixel refresh. */
    idle: Capability;
    ereading: Capability;
    gamut: Capability & {options: string[]};
    battery: {present: boolean; onBattery: boolean};
    recommendedBrightness: number;
    /** Present after a reset: whether the kernel backlight could be restored too. */
    brightness?: {ok: boolean; percent?: number; reason?: string};
}
export type DisplayCareAction = 'get' | 'set' | 'reset';
export interface DisplayCareControls {request(action: DisplayCareAction, ...args: string[]): Promise<DisplayCareState>; destroy(): void;}
const unavailable = {available: false, reason: ''};
export const unsupportedDisplayCare: DisplayCareState = {settings: defaultCare, gamma: unavailable, idle: unavailable, ereading: unavailable, gamut: {...unavailable, options: ['native']}, battery: {present: false, onBattery: false}, recommendedBrightness: 70};
export const splendidModes = {
    normal: {title: 'Normal', description: 'Through Gamma and Color temperature correction, the image output from the panel is as close as possible to what your eye can naturally see.'},
    vivid: {title: 'Vivid', description: 'Adjusts the contrast of the image making it more vivid and vibrant.'},
    manual: {title: 'Manual', description: 'Adjusts the color temperature value to your personal needs, ranging from -50 to +50.'},
    eyecare: {title: 'Eye Care', description: 'Eye Care mode reduces blue light emission by up to 30%, which helps in protecting your eyes.'},
    ereading: {title: 'E-Reading', description: 'Switches the display to black and white to minimize color impact, enhance readability, and reduce eye strain during prolonged reading sessions.'},
} as const;
export class DisplayCare implements DisplayCareControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    request(action: DisplayCareAction, ...args: string[]): Promise<DisplayCareState> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Display settings closed.')); return;}
            try {
                const local = `${ROOT}/bin/dev-os-display-care`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-display-care');
                if (!helper) throw new Error('Display care is not installed.');
                const child = Gio.Subprocess.new(['python3', helper, action, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(null, null, (_source, result) => {
                    if (timer) GLib.source_remove(timer); this.processes.delete(child);
                    try {const [, out, err] = child.communicate_utf8_finish(result); const response = JSON.parse(out || '{}'); if (!child.get_successful() || response.ok !== true) throw new Error(response.error || err || 'Display settings failed.'); resolve(response as DisplayCareState);} catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
