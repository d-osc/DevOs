import {HelperClient} from './helper-client.js';
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
    private client = new HelperClient<BatteryCareState, BatteryCareAction>('dev-os-battery-care', 120, {closed: 'Battery settings closed.', missing: 'Battery care is not installed.', failed: 'Battery settings failed.'});
    request(action: BatteryCareAction, enabled?: boolean): Promise<BatteryCareState> {return this.client.request(action, ...(enabled === undefined ? [] : [enabled ? 'on' : 'off']));}
    destroy() {this.client.destroy();}
}
