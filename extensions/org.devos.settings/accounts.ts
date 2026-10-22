import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export interface AccountResult {identity?: {provider: string; name: string; login?: string; id?: number}; clientId?: string; code?: string; url?: string; interval?: number; pending?: boolean;
    system?: {available: boolean; currentUser: string; users: {username: string; name: string; uid: number; home: string; github?: string; githubId?: number}[]; binding?: {id: number; login: string}; firstSetup: boolean};}
export interface AccountControls {request(action: string, clientId?: string, data?: object): Promise<AccountResult>; destroy(): void;}
export class Accounts implements AccountControls {
    private processes = new Set<Gio.Subprocess>();
    request(action: string, clientId?: string, data?: object): Promise<AccountResult> {
        return new Promise((resolve, reject) => {
            const local = `${ROOT}/bin/dev-os-accounts`;
            const helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-accounts');
            if (!helper) {reject(new Error('DevOs account service is not installed.')); return;}
            const process = Gio.Subprocess.new(['d', helper], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            this.processes.add(process);
            process.communicate_utf8_async(JSON.stringify({...data, action, clientId}), null, (_source, result) => {
                this.processes.delete(process);
                try {const [, stdout] = process.communicate_utf8_finish(result); const response = JSON.parse(stdout || '{}'); if (!process.get_successful() || !response.ok) throw new Error(response.error || 'Account service failed.'); resolve(response);}
                catch (error) {reject(error);}
            });
        });
    }
    destroy() {for (const process of this.processes) process.force_exit(); this.processes.clear();}
}
