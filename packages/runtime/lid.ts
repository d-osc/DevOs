import {Gio, GLib} from '@dev-os/core/base';

export interface LidSource { watch(handler: (closed: boolean) => void): () => void; }

// logind does not guarantee a PropertiesChanged signal for LidClosed, so poll
// asynchronously; this also works without direct access to privileged evdev nodes.
export const logindLid: LidSource = {
    watch(handler) {
        let stopped = false, pending = false;
        const cancellable = new Gio.Cancellable();
        const read = () => {
            if (pending || stopped) return;
            pending = true;
            Gio.DBus.system.call('org.freedesktop.login1', '/org/freedesktop/login1',
                'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['org.freedesktop.login1.Manager', 'LidClosed']),
                null, Gio.DBusCallFlags.NONE, 3000, cancellable, (connection, result) => {
                    pending = false;
                    try {
                        const [value] = connection!.call_finish(result).deep_unpack() as [GLib.Variant];
                        if (!stopped) handler(value.deep_unpack() === true);
                    } catch { /* Desktop and minimal systems may have no lid/logind. */ }
                });
        };
        read();
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => { read(); return GLib.SOURCE_CONTINUE; });
        return () => { stopped = true; cancellable.cancel(); GLib.source_remove(timer); };
    },
};

function execute(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const process = Gio.Subprocess.new(args, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        process.communicate_utf8_async(null, null, (source, result) => {
            try {
                const [, output, error] = source!.communicate_utf8_finish(result);
                if (!process.get_successful()) throw new Error(error || 'Display power control failed');
                resolve(output ?? '');
            } catch (error) { reject(error); }
        });
    });
}

export function internalOutputs(list: string): string[] {
    return list.split('\n').map(line => line.trim().split(/[\s:]/)[0])
        .filter(name => /^(eDP|LVDS|DSI)-[A-Za-z0-9-]+$/.test(name));
}

export async function lidDisplayPower(on: boolean): Promise<void> {
    const outputs = internalOutputs(await execute(['wlopm']));
    if (outputs.length) await execute(['wlopm', ...outputs.flatMap(name => [on ? '--on' : '--off', name])]);
}

/** Serialize lid transitions: secure cover first, then panel power, never suspend. */
export class LidStandby {
    private previous: boolean | undefined;
    private stop?: () => void;
    private serial = 0;
    private queue = Promise.resolve();
    constructor(private lock: (ready: (secured: boolean) => void) => boolean,
        private report: (message: string) => void,
        private source: LidSource = logindLid,
        private power: (on: boolean) => Promise<void> = lidDisplayPower) {}
    start() {
        this.stop = this.source.watch(closed => {
            if (closed === this.previous) return;
            const initial = this.previous === undefined;
            this.previous = closed;
            if (initial && !closed) return;
            const serial = ++this.serial;
            this.queue = this.queue.then(async () => {
                if (serial !== this.serial) return;
                await new Promise<void>((resolve, reject) => {
                    if (!this.lock(secured => secured ? resolve() : reject(new Error('Lock screen did not become ready'))))
                        reject(new Error('Could not secure the screen'));
                });
                if (serial === this.serial) await this.power(!closed);
            }).catch(error => this.report(`Lid display control: ${String(error)}`));
        });
    }
    destroy() { ++this.serial; this.stop?.(); this.stop = undefined; }
}
