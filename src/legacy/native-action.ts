import {Gio, GLib} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';

/** One-shot DevLang requests. Failure and timeout never retry a mutation. */
export class NativeAction {
    private disposed = false;
    private cancel = new Gio.Cancellable();
    private children = new Set<Gio.Subprocess>();
    constructor(private source: string) {}
    run(request: object): Promise<void> {
        return this.request(request).then(() => {});
    }
    request<T extends {ok?: boolean; error?: string}>(request: object): Promise<T> {
        if (this.disposed) return Promise.reject(new Error('Action client disposed'));
        return new Promise((resolve, reject) => {
            let child: Gio.Subprocess;
            try {child = Gio.Subprocess.new([GLib.getenv('DEVLANG_RUN') || 'd', `${ROOT}/${this.source}`], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);}
            catch (error) {reject(error); return;}
            this.children.add(child);
            let expired = false;
            let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {timer = 0; expired = true; child.force_exit(); return GLib.SOURCE_REMOVE;});
            child.communicate_utf8_async(JSON.stringify(request) + '\n', this.cancel, (_source, result) => {
                if (timer) GLib.source_remove(timer);
                this.children.delete(child);
                try {
                    const [, stdout, stderr] = child.communicate_utf8_finish(result);
                    if (expired) throw new Error('Device action timed out; refresh its state before trying again.');
                    const reply = JSON.parse(stdout?.trim() || '{}') as T;
                    if (!child.get_successful() || !reply.ok) throw new Error(reply.error || stderr?.trim() || 'Device action failed');
                    resolve(reply);
                } catch (error) {reject(error);}
            });
        });
    }
    destroy() {this.disposed = true; this.cancel.cancel(); for (const child of this.children) child.force_exit(); this.children.clear();}
}
