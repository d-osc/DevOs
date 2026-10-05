import {
    GLibUnix
} from '@dev-os/core';

// The generated GIR types expose the C alias signal_add, while GJS exposes
// signal_add_full. Keep this version-specific binding at one typed boundary.
interface UnixSignals {
    signal_add_full(priority: number, signal: number, callback: () => boolean): number;
}
export function addUnixSignal(priority: number, signal: number, callback: () => boolean): number {
    return (GLibUnix as unknown as UnixSignals).signal_add_full(priority, signal, callback);
}
