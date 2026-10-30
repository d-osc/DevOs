import {Gio, GLib} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
export class DeviceRequest {
    private children = new Set<Gio.Subprocess>(); private closed = false;
    constructor(private helper: string, private timeout = 30) {}
    request<T>(payload: Record<string, unknown>): Promise<T> {
        return new Promise((resolve, reject) => {
            if (this.closed) {reject(new Error('Settings closed.')); return;}
            try {
                const path = `${ROOT}/bin/${this.helper}`;
                const child = Gio.Subprocess.new(['d', path], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.children.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.timeout, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(JSON.stringify(payload), null, (_source, result) => {
                    if (timer) GLib.source_remove(timer); this.children.delete(child);
                    try {const [, out, err] = child.communicate_utf8_finish(result); const value = JSON.parse(out || '{}'); if (!child.get_successful() || value.ok !== true) throw new Error(value.error || err || 'Device request failed.'); resolve(value);} catch (error) {reject(error);}
                });
            } catch (error) {reject(error);}
        });
    }
    destroy() {this.closed = true; for (const child of this.children) child.force_exit(); this.children.clear();}
}
