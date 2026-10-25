import {HelperClient} from './helper-client.js';
export type NoiseMode = 'authentic' | 'general' | 'conference';
/** Result of `dev-os-microphone get`: the real PipeWire microphones, the saved mode and what is really running. */
export interface MicNoiseState {
    supported: boolean; reason: string;
    mode: NoiseMode;
    /** The mode that is really processing the default input right now (authentic when nothing is). */
    active: NoiseMode; running: boolean;
    sources: {name: string; title: string}[]; device: string;
    /** The WebRTC noise suppression plugin is installed; without it only Authentic Recording is offered. */
    noise: {available: boolean; reason: string};
    warning: string;
}
export type MicNoiseAction = 'get' | 'mode' | 'device';
export interface MicNoiseControls {request(action: MicNoiseAction, ...args: string[]): Promise<MicNoiseState>; destroy(): void;}
export const unsupportedMicNoise: MicNoiseState = {supported: false, reason: '', mode: 'authentic', active: 'authentic', running: false, sources: [], device: '', noise: {available: false, reason: ''}, warning: ''};
/** Texts follow the MyASUS card. The backend is WebRTC noise suppression and gain control, so the Multi-presenter text says what it really does. */
export const noiseModes: Record<NoiseMode, {title: string; description: string}> = {
    general: {title: '360° Recording Mode', description: 'Reduce ambient noise from your surroundings to capture the best tone and audio details from all around you.'},
    authentic: {title: 'Authentic Recording', description: 'Turn off AI noise-canceling functions.'},
    conference: {title: 'Multi-presenter Mode', description: 'Filters out ambient noise and evens out the volume of everyone in a shared space, near or far, so the whole meeting is heard. It does not tell speakers apart.'},
};
export class MicNoise extends HelperClient<MicNoiseState, MicNoiseAction> implements MicNoiseControls {
    constructor() {super('dev-os-microphone', 90, {closed: 'Microphone settings closed.', missing: 'Microphone noise canceling is not installed.', failed: 'Microphone settings failed.'});}
}
