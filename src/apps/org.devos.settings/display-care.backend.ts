import {HelperClient} from './helper-client.js';
import {defaultCare, type CareSettings} from '../../legacy/display-care.js';
export type {CareSettings, Splendid} from '../../legacy/display-care.js';
export interface Capability {available: boolean; reason: string;}
/** Result of `dev-os-display-care get`: the saved values and what this session's compositor can really do. */
export interface DisplayCareState {
    settings: CareSettings;
    /** wlr-gamma-control: carries Splendid and Flicker-Free Dimming. */
    gamma: Capability;
    /** ext-idle-notify: starts Pixel refresh. */
    idle: Capability;
    ereading: Capability;
    gamut: Capability & {options: string[]};
    battery: {present: boolean; onBattery: boolean};
    recommendedBrightness: number;
    /** Present after a reset: whether the kernel backlight could be restored too. */
    brightness?: {ok: boolean; percent?: number; reason?: string};
}
export type DisplayCareAction = 'get' | 'set' | 'reset';
export interface DisplayCareControls {request(action: DisplayCareAction, ...args: string[]): Promise<DisplayCareState>; destroy(): void;}
const unavailable = {available: false, reason: ''};
export const unsupportedDisplayCare: DisplayCareState = {settings: defaultCare, gamma: unavailable, idle: unavailable, ereading: unavailable, gamut: {...unavailable, options: ['native']}, battery: {present: false, onBattery: false}, recommendedBrightness: 70};
export const splendidModes = {
    normal: {title: 'Normal', description: 'Through Gamma and Color temperature correction, the image output from the panel is as close as possible to what your eye can naturally see.'},
    vivid: {title: 'Vivid', description: 'Adjusts the contrast of the image making it more vivid and vibrant.'},
    manual: {title: 'Manual', description: 'Adjusts the color temperature value to your personal needs, ranging from -50 to +50.'},
    eyecare: {title: 'Eye Care', description: 'Eye Care mode reduces blue light emission by up to 30%, which helps in protecting your eyes.'},
    ereading: {title: 'E-Reading', description: 'Switches the display to black and white to minimize color impact, enhance readability, and reduce eye strain during prolonged reading sessions.'},
} as const;
export class DisplayCare extends HelperClient<DisplayCareState, DisplayCareAction> implements DisplayCareControls {
    constructor() {super('dev-os-display-care', 60, {closed: 'Display settings closed.', missing: 'Display care is not installed.', failed: 'Display settings failed.'});}
}
