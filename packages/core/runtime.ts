import {GLib} from './native.js';

// React's scheduler expects browser-like timers. GJS dispatches these on GLib.
if (!globalThis.setTimeout) {
    const timers = new Set<number>();
    globalThis.setTimeout = (callback, delay = 0, ...args) => {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, delay), () => {
            timers.delete(id); callback(...args); return GLib.SOURCE_REMOVE;
        });
        timers.add(id); return id;
    };
    globalThis.clearTimeout = id => { if (timers.delete(id)) GLib.source_remove(id); };
}
globalThis.performance ??= {now: () => GLib.get_monotonic_time() / 1000};
globalThis.queueMicrotask ??= callback => Promise.resolve().then(callback);
