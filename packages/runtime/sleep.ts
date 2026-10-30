import {Gio, GLib} from '@dev-os/core/base';

const bus = 'org.freedesktop.login1', path = '/org/freedesktop/login1', manager = 'org.freedesktop.login1.Manager';
/** Longest wait for the lock screen; logind's InhibitDelayMaxSec is 5 s, after which it suspends anyway. */
export const LOCK_WAIT_MS = 2500;

/** The two logind calls the guard needs, so the ordering can be tested without D-Bus. */
export interface SleepSource {
    /** Calls `handler(true)` just before the system sleeps and `handler(false)` after it wakes. */
    watch(handler: (sleeping: boolean) => void): () => void;
    /** Takes a logind delay lock; resolves to a function that releases it, or null when logind is unavailable. */
    inhibit(): Promise<(() => void) | null>;
}

export const logindSleep: SleepSource = {
    watch(handler) {
        const id = Gio.DBus.system.signal_subscribe(bus, manager, 'PrepareForSleep', path, null, Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters) => {
                handler((parameters.deep_unpack() as [boolean])[0]);
            });
        return () => Gio.DBus.system.signal_unsubscribe(id);
    },
    inhibit() {
        return new Promise(resolve => {
            Gio.DBus.system.call_with_unix_fd_list(bus, path, manager, 'Inhibit',
                new GLib.Variant('(ssss)', ['sleep', 'Dev OS', 'Lock the screen before the system sleeps', 'delay']),
                null, Gio.DBusCallFlags.NONE, 5000, null, null, (connection, result) => {
                    try {
                        const [reply, descriptors] = connection!.call_with_unix_fd_list_finish(result);
                        const fd = descriptors!.get((reply.deep_unpack() as [number])[0]);
                        resolve(() => { try { GLib.close(fd); } catch { /* already closed */ } });
                    } catch { resolve(null); } // WSL and minimal systems have no logind.
                });
        });
    },
};

/**
 * Locks the screen before the system sleeps, so that waking shows the lock screen at once instead of an
 * unlocked desktop that is locked a moment later. Sleep is held only until the lock is ready.
 */
export class SleepGuard {
    private release: (() => void) | null = null;
    private stop: (() => void) | undefined;
    private disposed = false;
    private acquiring = false;

    constructor(private lock: (ready: () => void) => void, private source: SleepSource = logindSleep) {}

    start() {
        this.stop = this.source.watch(sleeping => { if (sleeping) this.prepare(); else void this.acquire(); });
        void this.acquire();
    }

    private async acquire() {
        if (this.disposed || this.release || this.acquiring) return;
        this.acquiring = true;
        try {
            const release = await this.source.inhibit();
            if (this.disposed) release?.(); else this.release = release;
        } finally { this.acquiring = false; }
    }

    private prepare() {
        let done = false, timer = 0;
        const finish = () => {
            if (done) return;
            done = true;
            if (timer) GLib.source_remove(timer);
            this.release?.(); this.release = null;
        };
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LOCK_WAIT_MS, () => { timer = 0; finish(); return GLib.SOURCE_REMOVE; });
        try { this.lock(finish); } catch { finish(); }
    }

    destroy() {
        this.disposed = true;
        this.stop?.(); this.stop = undefined;
        this.release?.(); this.release = null;
    }
}
