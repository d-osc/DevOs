import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export type GestureTarget = 'task-manager' | 'launcher' | 'task-view' | 'settings' | 'files' | 'terminal' | 'none';
/** Result of `dev-os-touchpad-gestures get`: what the touchpad and the tools behind each gesture really allow. */
export interface TouchpadGesturesState {
    /** A touchpad was found in the kernel's input device list. */
    supported: boolean; reason: string; devices: string[];
    locked: boolean; enabled: boolean; launch: GestureTarget;
    /** The touchpad's event node is readable by this user, which edge gestures need. */
    gesturesAvailable: boolean;
    backends: {volume: boolean; brightness: boolean; seek: boolean; launch: boolean};
    targets: {id: GestureTarget; title: string}[];
}
export type TouchpadGesturesAction = 'get' | 'lock' | 'gestures' | 'launch';
export interface TouchpadGesturesControls {request(action: TouchpadGesturesAction, ...args: string[]): Promise<TouchpadGesturesState>; destroy(): void;}
export const gestureTargets: {id: GestureTarget; title: string}[] = [
    {id: 'task-manager', title: 'Task Manager'}, {id: 'launcher', title: 'Application launcher'}, {id: 'task-view', title: 'Task View'},
    {id: 'settings', title: 'Settings'}, {id: 'files', title: 'Files'}, {id: 'terminal', title: 'Terminal'}, {id: 'none', title: 'Nothing'},
];
export const unsupportedTouchpadGestures: TouchpadGesturesState = {
    supported: false, reason: '', devices: [], locked: false, enabled: false, launch: 'task-manager', gesturesAvailable: false,
    backends: {volume: false, brightness: false, seek: false, launch: false}, targets: gestureTargets,
};
export class TouchpadGestures implements TouchpadGesturesControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    request(action: TouchpadGesturesAction, ...args: string[]): Promise<TouchpadGesturesState> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Touchpad settings closed.')); return;}
            try {
                const local = `${ROOT}/bin/dev-os-touchpad-gestures`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-touchpad-gestures');
                if (!helper) throw new Error('Touchpad gestures are not installed.');
                const child = Gio.Subprocess.new(['python3', helper, action, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(null, null, (_source, result) => {
                    if (timer) GLib.source_remove(timer); this.processes.delete(child);
                    try {const [, out, err] = child.communicate_utf8_finish(result); const response = JSON.parse(out || '{}'); if (!child.get_successful() || response.ok !== true) throw new Error(response.error || err || 'Touchpad gesture settings failed.'); resolve(response as TouchpadGesturesState);} catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
