import {serviceClass} from '@dev-os/runtime/app-service';
import {HelperClient} from './helper-client.js';
export type SwapType = 'zram' | 'file' | 'off';
export type SwapAlgorithm = 'zstd' | 'lz4';
/** Result of `dev-os-swap get`: the saved setting, what is running, and the limits the helper enforces. */
export interface SwapState {
    live: boolean; fileAllowed: boolean; fileReason: string;
    memTotalMiB: number; minMiB: number; maxMiB: number; maxFileMiB: number;
    configured: boolean; type: SwapType; percent: number | null; sizeMiB: number; algorithm: SwapAlgorithm; swappiness: number; currentSwappiness: number | null;
    active: {type: 'zram' | 'file' | 'other' | 'none'; sizeBytes: number; usedBytes: number; dataBytes: number; compressedBytes: number; memoryBytes: number; algorithm: string};
}
/** The setting the user is editing; `percent` is null for a custom size in MiB. */
export interface SwapDraft {type: SwapType; percent: number | null; mib: number; algorithm: SwapAlgorithm; swappiness: number}
export type SwapAction = 'get' | 'set';
export interface SwapControls {request(action: SwapAction, ...args: string[]): Promise<SwapState>; destroy(): void;}
export const emptySwap: SwapState = {live: false, fileAllowed: false, fileReason: '', memTotalMiB: 0, minMiB: 256, maxMiB: 0, maxFileMiB: 0, configured: false, type: 'zram', percent: 100, sizeMiB: 0, algorithm: 'zstd', swappiness: 100, currentSwappiness: null,
    active: {type: 'none', sizeBytes: 0, usedBytes: 0, dataBytes: 0, compressedBytes: 0, memoryBytes: 0, algorithm: ''}};
export const swapPresets = [25, 50, 100, 150, 200] as const;
export const swapTypes: Record<SwapType, {title: string; description: string}> = {
    zram: {title: 'Compressed RAM (zram)', description: 'Keeps rarely used memory compressed in RAM. Fast, needs no disk and is the default.'},
    file: {title: 'Swap file on disk', description: 'Moves rarely used memory to a file on the system disk. Slower, and only on an installed system.'},
    off: {title: 'Off', description: 'No swap. Programs are closed when memory runs out.'},
};
export const formatSize = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.round(bytes / 1048576)} MB`;
export const mibOf = (state: SwapState, draft: SwapDraft) => draft.percent === null ? draft.mib : Math.floor(state.memTotalMiB * draft.percent / 100);
/** Why the draft cannot be applied, or an empty string. Mirrors the helper, which checks the same limits again as root. */
export function draftProblem(state: SwapState, draft: SwapDraft): string {
    if (draft.type === 'off') return '';
    if (draft.type === 'file' && !state.fileAllowed) return state.fileReason || 'A swap file is not available on this system.';
    const mib = mibOf(state, draft), upper = draft.type === 'file' ? Math.min(state.maxMiB, state.maxFileMiB) : state.maxMiB;
    if (!Number.isFinite(mib) || mib < state.minMiB) return `The size must be at least ${state.minMiB} MB.`;
    if (mib > upper) return draft.type === 'file' && state.maxFileMiB < state.maxMiB ? `There is only room for ${formatSize(state.maxFileMiB * 1048576)} of swap on the disk (a reserve stays free).` : `The size can be at most twice the RAM (${formatSize(state.maxMiB * 1048576)}).`;
    return '';
}
/** "6.5" gigabytes to whole MiB; NaN when it is not a plain number. */
export function gigabytesToMiB(text: string): number {
    const value = text.trim().replace(',', '.');
    return /^\d+(\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 1024) : NaN;
}
export function draftOf(state: SwapState): SwapDraft {return {type: state.type, percent: state.percent, mib: state.sizeMiB, algorithm: state.algorithm, swappiness: state.swappiness};}
export function draftArguments(draft: SwapDraft): string[] {
    return [`type=${draft.type}`, ...(draft.type === 'off' ? [] : [draft.percent === null ? `mib=${draft.mib}` : `percent=${draft.percent}`, `algorithm=${draft.algorithm}`]), `swappiness=${draft.swappiness}`];
}
export type Swap = import('./swap.backend.js').Swap;
export const Swap = serviceClass<typeof import('./swap.backend.js').Swap>('settings/swap.Swap', {}, []);
