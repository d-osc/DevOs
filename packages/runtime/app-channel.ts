import {Gio, GLib} from '@dev-os/core/base';

/** Private, asynchronous JSON channel. stdout is reserved for protocol frames. */
export class AppChannel {
    private input: Gio.DataInputStream;
    private output: Gio.OutputStream;
    private cancel = new Gio.Cancellable();
    private writes: Promise<void> = Promise.resolve();
    private stopped = false;
    constructor(input: Gio.InputStream, output: Gio.OutputStream, private receive: (frame: any) => void,
        private disconnected: (error: Error) => void) {
        this.input = new Gio.DataInputStream({base_stream: input}); this.output = output;
        this.read();
    }
    send(frame: unknown): Promise<void> {
        if (this.stopped) return Promise.reject(new Error('App service disconnected.'));
        const bytes = new TextEncoder().encode(JSON.stringify(frame) + '\n');
        const write = this.writes.then(() => new Promise<void>((resolve, reject) => {
            const data = new GLib.Bytes(bytes);
            let offset = 0;
            const next = () => this.output.write_bytes_async(GLib.Bytes.new_from_bytes(data, offset, bytes.length - offset), GLib.PRIORITY_DEFAULT, this.cancel, (_stream, result) => {
                try {
                    const count = this.output.write_bytes_finish(result);
                    if (count <= 0) throw new Error('App service pipe closed.');
                    offset += count;
                    if (offset < bytes.length) next(); else resolve();
                } catch (error) {reject(error);}
            });
            next();
        }));
        this.writes = write.catch(error => {this.fail(error);});
        return write;
    }
    private read() {
        this.input.read_line_async(GLib.PRIORITY_DEFAULT, this.cancel, (_stream, result) => {
            if (this.stopped) return;
            try {
                const [line] = this.input.read_line_finish_utf8(result);
                if (line === null) throw new Error('App service disconnected.');
                this.receive(JSON.parse(line)); this.read();
            } catch (error) {this.fail(error);}
        });
    }
    private fail(error: unknown) {
        if (this.stopped) return;
        this.close(); this.disconnected(error instanceof Error ? error : new Error(String(error)));
    }
    close() {if (this.stopped) return; this.stopped = true; this.cancel.cancel();}
}

