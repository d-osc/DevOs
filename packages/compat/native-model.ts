import {Gio, GLib} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';

/** Bounded latest-value model requests; all data decisions run in DevLang. */
export class NativeModel {
    private child?: Gio.Subprocess;
    private input?: Gio.DataInputStream;
    private output?: Gio.OutputStream;
    private pending = false;
    private writing = false;
    private disposed = false;
    private latest?: Uint8Array;
    private snapshot?: Uint8Array;
    private sequence = 0;
    private retry = 0;
    private cancel?: Gio.Cancellable;
    private acknowledged = false;
    constructor(private source: string, private changed: (value: any) => void) {this.start();}
    submit(value: object) {
        if (this.disposed) return;
        this.latest = this.snapshot = new TextEncoder().encode(JSON.stringify({...value, id: ++this.sequence}) + '\n');
        this.write();
    }
    private write() {
        if (this.disposed || this.pending || this.writing || !this.latest || !this.output) return;
        const stream = this.output, bytes = this.latest; this.latest = undefined; this.pending = this.writing = true;
        stream.write_all_async(bytes, GLib.PRIORITY_DEFAULT, this.cancel ?? null, (_stream, result) => {
            try {stream.write_all_finish(result);} catch (error) {if (!this.disposed && stream === this.output) {printerr(String(error)); this.pending = false; this.child?.force_exit();}}
            if (this.disposed || stream !== this.output) return;
            this.writing = false; this.write();
        });
    }
    private read(stream: Gio.DataInputStream) {
        stream.read_line_async(GLib.PRIORITY_DEFAULT, this.cancel ?? null, (_stream, result) => {
            try {
                const [line] = stream.read_line_finish_utf8(result);
                if (this.disposed || stream !== this.input) return;
                if (line === null) return;
                this.pending = false;
                if (line.length > 4 * 1024 * 1024) throw new Error('Native model frame exceeds 4 MiB');
                const value = JSON.parse(line);
                if (value.error) printerr(value.error);
                else if (value.id === this.sequence) {
                    if (!this.acknowledged && GLib.getenv('DEVOS_SYSTEM_TRACE')) print(`DevOs model data ready: ${this.source}`);
                    this.acknowledged = true; this.changed(value);
                }
                this.read(stream); this.write();
            } catch (error) {if (!this.disposed && stream === this.input) {printerr(`Native model: ${String(error)}`); this.child?.force_exit();}}
        });
    }
    private start() {
        if (this.disposed) return;
        try {this.spawn();} catch (error) {printerr(`Native model: ${String(error)}`); this.schedule();}
    }
    private schedule() {
        if (this.disposed || this.retry) return;
        this.retry = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {this.retry = 0; this.start(); return GLib.SOURCE_REMOVE;});
    }
    private spawn() {
        const child = this.child = Gio.Subprocess.new([GLib.getenv('DEVLANG_RUN') || 'd', `${ROOT}/${this.source}`], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        this.cancel = new Gio.Cancellable();
        this.acknowledged = false;
        this.output = child.get_stdin_pipe()!; this.input = new Gio.DataInputStream({base_stream: child.get_stdout_pipe()!});
        this.latest = this.snapshot;
        this.read(this.input); this.write();
        child.wait_async(null, (_child, result) => {
            try {child.wait_finish(result);} catch {}
            if (this.disposed || this.child !== child) return;
            this.cancel?.cancel(); try {this.output?.close(null);} catch {}
            this.child = undefined; this.input = undefined; this.output = undefined; this.pending = this.writing = false;
            this.schedule();
        });
    }
    destroy() {this.disposed = true; if (this.retry) GLib.source_remove(this.retry); this.cancel?.cancel(); try {this.output?.close(null);} catch {} this.child?.force_exit(); this.child = undefined; this.input = undefined; this.output = undefined; this.latest = this.snapshot = undefined;}
}
