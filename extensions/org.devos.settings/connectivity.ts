import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export type TaskFirstProfile = 'off' | 'productivity' | 'streaming' | 'games';
/** Result of `dev-os-connectivity get`. */
export interface ConnectivityState {
    taskfirstSupported: boolean; taskfirstReason: string; taskfirst: TaskFirstProfile;
    /** The traffic classes are installed on at least one network interface right now. */
    taskfirstActive: boolean; taskfirstInterfaces: string;
    smartconnectSupported: boolean; smartconnectReason: string; smartconnect: boolean; smartconnectRunning: boolean; smartconnectLast: string;
}
export type ConnectivityAction = 'get' | 'taskfirst' | 'smartconnect';
export interface ConnectivityControls {request(action: ConnectivityAction, ...args: string[]): Promise<ConnectivityState>; destroy(): void;}
export const unsupportedConnectivity: ConnectivityState = {taskfirstSupported: false, taskfirstReason: '', taskfirst: 'off', taskfirstActive: false, taskfirstInterfaces: '', smartconnectSupported: false, smartconnectReason: '', smartconnect: false, smartconnectRunning: false, smartconnectLast: ''};
/** MyASUS' fifth option (Screen Extend, GlideX) does not exist in Dev OS and is left out. */
export const taskFirstProfiles: {id: TaskFirstProfile; title: string; description: string}[] = [
    {id: 'off', title: 'Off', description: 'Switch off data prioritizing'},
    {id: 'productivity', title: 'Productivity and Communication', description: 'Prioritize productivity and communication tasks, such as loading websites, cloud drives, and communication apps'},
    {id: 'streaming', title: 'Multimedia streaming', description: 'Prioritize audio / video streaming apps and websites'},
    {id: 'games', title: 'Games', description: 'Prioritize game-related tasks, such as gameplay and game live streaming'},
];
export class Connectivity implements ConnectivityControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    request(action: ConnectivityAction, ...args: string[]): Promise<ConnectivityState> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Connectivity settings closed.')); return;}
            try {
                const local = `${ROOT}/bin/dev-os-connectivity`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-connectivity');
                if (!helper) throw new Error('Connectivity settings are not installed.');
                const child = Gio.Subprocess.new(['sh', helper, action, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 120, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(null, null, (_source, result) => {
                    if (timer) GLib.source_remove(timer); this.processes.delete(child);
                    try {const [, out, err] = child.communicate_utf8_finish(result); const response = JSON.parse(out || '{}'); if (!child.get_successful() || response.ok !== true) throw new Error(response.error || err || 'Connectivity settings failed.'); resolve(response as ConnectivityState);} catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
