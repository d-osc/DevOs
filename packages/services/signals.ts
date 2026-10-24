import {
    GLibUnix
} from '@dev-os/core/base';

// GLib's GIR name differs between the build host and the native image.
type SignalAdd = (priority: number, signal: number, callback: () => boolean) => number;
interface UnixSignals {
    signal_add?: SignalAdd;
    signal_add_full?: SignalAdd;
}
export function addUnixSignal(priority: number, signal: number, callback: () => boolean): number {
    const signals = GLibUnix as unknown as UnixSignals;
    const add = signals.signal_add ?? signals.signal_add_full;
    if (typeof add !== 'function') throw new Error('GLibUnix has no Unix signal registration function');
    return add.call(GLibUnix, priority, signal, callback);
}
