import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export interface TouchpadValues {tap: boolean; drag: boolean; natural: boolean; typing: boolean; leftHanded: boolean; speed: number;}
export interface TouchpadState {settings: TouchpadValues; devices: string[]; applied: boolean;}
export interface TouchpadControls {request(action: 'get' | 'save' | 'reset', settings?: TouchpadValues): Promise<TouchpadState>; destroy(): void;}
export const defaultTouchpad: TouchpadValues = {tap: true, drag: true, natural: true, typing: true, leftHanded: false, speed: 50};
export class Touchpad implements TouchpadControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    request(action: 'get' | 'save' | 'reset', settings?: TouchpadValues): Promise<TouchpadState> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Touchpad settings closed.')); return;}
            try {
                const local = `${ROOT}/bin/dev-os-touchpad`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-touchpad');
                if (!helper) throw new Error('Touchpad controls are not installed.');
                const child = Gio.Subprocess.new(['d', helper], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(JSON.stringify({action, settings}), null, (_source, result) => {if (timer) GLib.source_remove(timer); this.processes.delete(child); try {const [, out, err] = child.communicate_utf8_finish(result); const response = JSON.parse(out || '{}'); if (!child.get_successful() || response.ok !== true) throw new Error(response.error || err || 'Touchpad settings failed.'); resolve(response);} catch (reason) {reject(reason);}});
            } catch (reason) {reject(reason);}
        });
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
