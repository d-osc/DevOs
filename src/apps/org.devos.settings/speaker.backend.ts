import {HelperClient} from './helper-client.js';
export type SoundMode = 'dynamic' | 'game' | 'movie' | 'music' | 'voice' | 'custom1' | 'custom2' | 'custom3';
export type CustomSlot = 'custom1' | 'custom2' | 'custom3';
/** Result of `dev-os-speaker get`: the real PipeWire outputs, the saved settings and what the filter graph is really doing. */
export interface SpeakerState {
    supported: boolean; reason: string;
    speakers: {name: string; title: string}[]; device: string;
    /** "AI Noise-Canceling Speaker": the voice-band filter. */
    voice: boolean; mode: SoundMode; smart: boolean;
    /** Volume Booster: extra gain into a soft saturator. */
    boost: boolean;
    /** Bass, mid, treble in dB per custom slot. */
    custom: Record<CustomSlot, [number, number, number]>;
    /** The mode in use right now (Voice while an app records and the smart switch is on). */
    effective: SoundMode;
    running: boolean; active: boolean;
    filters: {available: boolean; reason: string};
    warning: string;
}
export type SpeakerAction = 'get' | 'voice' | 'boost' | 'mode' | 'smart' | 'device' | 'custom';
export interface SpeakerControls {request(action: SpeakerAction, ...args: string[]): Promise<SpeakerState>; destroy(): void;}
export const unsupportedSpeaker: SpeakerState = {supported: false, reason: '', speakers: [], device: '', voice: false, boost: false, mode: 'dynamic', smart: true, custom: {custom1: [0, 0, 0], custom2: [0, 0, 0], custom3: [0, 0, 0]}, effective: 'dynamic', running: false, active: false, filters: {available: false, reason: ''}, warning: ''};
/** The backend is equalizer curves, not Dolby Atmos, so the descriptions say what each curve does. */
export const soundModes: Record<SoundMode, {title: string; description: string}> = {
    dynamic: {title: 'Dynamic', description: 'No sound processing. Audio plays as it is.'},
    game: {title: 'Game', description: 'Lifts the upper mids and treble so footsteps and effects stand out.'},
    movie: {title: 'Movie', description: 'Fuller bass and clearer highs for film soundtracks.'},
    music: {title: 'Music', description: 'A balanced curve with warmer bass and brighter highs.'},
    voice: {title: 'Voice', description: 'Pulls back the bass and lifts the voice range so every word is clear.'},
    custom1: {title: 'Custom 1', description: 'Your own bass, mid and treble levels.'},
    custom2: {title: 'Custom 2', description: 'Your own bass, mid and treble levels.'},
    custom3: {title: 'Custom 3', description: 'Your own bass, mid and treble levels.'},
};
export class Speaker extends HelperClient<SpeakerState, SpeakerAction> implements SpeakerControls {
    constructor() {super('dev-os-speaker', 90, {closed: 'Sound settings closed.', missing: 'Sound effects are not installed.', failed: 'Sound settings failed.'});}
}
