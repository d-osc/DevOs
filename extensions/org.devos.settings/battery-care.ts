import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
/** Result of `dev-os-battery-care get`: what the kernel offers and what Battery Care Mode is doing. */
export interface BatteryCareState {
    /** The battery driver exposes charge_control_end_threshold, so the limit can really be set. */
    supported: boolean; battery: string; reason: string;
    care: boolean; full: boolean;
    /** Epoch seconds when Instant Full-Charge ends, and seconds left; 0 when it is off. */
    fullUntil: number; remaining: number;
    threshold: number | null; limit: number;
    /** Per-user: show the Instant Full-Charge switch in the panel quick settings. */
    quick: boolean;
}
export type BatteryCareAction = 'get' | 'care' | 'full' | 'quick';
export interface BatteryCareControls {request(action: BatteryCareAction, enabled?: boolean): Promise<BatteryCareState>; destroy(): void;}
export const unsupportedBatteryCare: BatteryCareState = {supported: false, battery: '', reason: '', care: false, full: false, fullUntil: 0, remaining: 0, threshold: null, limit: 80, quick: true};
export function remainingText(seconds: number): string {
    const minutes = Math.max(1, Math.ceil(seconds / 60)), hours = Math.floor(minutes / 60);
    return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}
export class BatteryCare implements BatteryCareControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    request(action: BatteryCareAction, enabled?: boolean): Promise<BatteryCareState> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Battery settings closed.')); return;}
            try {
                const local = `${ROOT}/bin/dev-os-battery-care`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-battery-care');
                if (!helper) throw new Error('Battery care is not installed.');
                const argv = ['sh', helper, action, ...(enabled === undefined ? [] : [enabled ? 'on' : 'off'])];
                const child = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 120, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(null, null, (_source, result) => {
                    if (timer) GLib.source_remove(timer); this.processes.delete(child);
                    try {const [, out, err] = child.communicate_utf8_finish(result); const response = JSON.parse(out || '{}'); if (!child.get_successful() || response.ok !== true) throw new Error(response.error || err || 'Battery settings failed.'); resolve(response as BatteryCareState);} catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
