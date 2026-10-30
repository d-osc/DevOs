import {Gio, GLib} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
export interface TimeState {available: boolean; hostManaged: boolean; timezone: string; ntp: boolean; canNtp: boolean; synchronized: boolean; zones: string[]; error: string;}
export type TimeAction = {action: 'set-timezone'; timezone: string} | {action: 'set-ntp'; enabled: boolean} | {action: 'set-time'; date: string; time: string};
export interface TimeControls {load(): Promise<TimeState>; update(action: TimeAction): Promise<TimeState>; openHostSettings(): Promise<void>; destroy(): void;}
export class LinuxTime implements TimeControls {
    private process?: Gio.Subprocess;
    private disposed = false;
    private request(request: object): Promise<{state: TimeState}> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Time settings closed.')); return;}
            try {
                const process = Gio.Subprocess.new(['d', `${ROOT}/bin/dev-os-time`], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                this.process = process;
                let timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 135, () => {timeout = 0; process.force_exit(); return GLib.SOURCE_REMOVE;});
                process.communicate_utf8_async(JSON.stringify(request), null, (_source, result) => {
                    if (timeout) GLib.source_remove(timeout); this.process = undefined;
                    try {
                        const [, stdout, stderr] = process.communicate_utf8_finish(result);
                        const response = JSON.parse(stdout || '{}');
                        if (!process.get_successful() || response.ok !== true) throw new Error(response.error || stderr || 'Could not update system time.');
                        resolve(response);
                    } catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    async load() {return (await this.request({action: 'get'})).state;}
    async update(action: TimeAction) {return (await this.request(action)).state;}
    async openHostSettings() {await this.request({action: 'windows-settings'});}
    destroy() {this.disposed = true; this.process?.force_exit();}
}
