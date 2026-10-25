import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export interface HelperMessages {
    /** Rejection when the card is closed while a request is pending. */
    closed: string;
    /** Rejection when `bin/<helper>` is neither in the checkout nor on PATH. */
    missing: string;
    /** Fallback when the helper fails without saying why. */
    failed: string;
}
/** Runs `sh <helper> <action> [args]` and resolves with the JSON the helper prints (`{ok: true, ...state}`). */
export class HelperClient<State, Action extends string = string> {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    constructor(private helper: string, private timeout: number, private messages: HelperMessages) {}
    request(action: Action, ...args: string[]): Promise<State> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error(this.messages.closed)); return;}
            try {
                const local = `${ROOT}/bin/${this.helper}`, path = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path(this.helper);
                if (!path) throw new Error(this.messages.missing);
                const child = Gio.Subprocess.new(['sh', path, action, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.timeout, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(null, null, (_source, result) => {
                    if (timer) GLib.source_remove(timer); this.processes.delete(child);
                    try {const [, out, err] = child.communicate_utf8_finish(result); const response = JSON.parse(out || '{}'); if (!child.get_successful() || response.ok !== true) throw new Error(response.error || err || this.messages.failed); resolve(response as State);} catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
