import {serviceClass} from '@dev-os/runtime/app-service';
import {HelperClient} from './helper-client.js';
export type GestureTarget = 'task-manager' | 'launcher' | 'task-view' | 'settings' | 'files' | 'terminal' | 'none';
/** Result of `dev-os-touchpad-gestures get`: what the touchpad and the tools behind each gesture really allow. */
export interface TouchpadGesturesState {
    /** A touchpad was found in the kernel's input device list. */
    supported: boolean; reason: string; devices: string[];
    locked: boolean; enabled: boolean; launch: GestureTarget;
    /** The touchpad's event node is readable by this user, which edge gestures need. */
    gesturesAvailable: boolean;
    backends: {volume: boolean; brightness: boolean; seek: boolean; launch: boolean};
    targets: {id: GestureTarget; title: string}[];
}
export type TouchpadGesturesAction = 'get' | 'lock' | 'gestures' | 'launch';
export interface TouchpadGesturesControls {request(action: TouchpadGesturesAction, ...args: string[]): Promise<TouchpadGesturesState>; destroy(): void;}
export const gestureTargets: {id: GestureTarget; title: string}[] = [
    {id: 'task-manager', title: 'Task Manager'}, {id: 'launcher', title: 'Application launcher'}, {id: 'task-view', title: 'Task View'},
    {id: 'settings', title: 'Settings'}, {id: 'files', title: 'Files'}, {id: 'terminal', title: 'Terminal'}, {id: 'none', title: 'Nothing'},
];
export const unsupportedTouchpadGestures: TouchpadGesturesState = {
    supported: false, reason: '', devices: [], locked: false, enabled: false, launch: 'task-manager', gesturesAvailable: false,
    backends: {volume: false, brightness: false, seek: false, launch: false}, targets: gestureTargets,
};
export type TouchpadGestures = import('./touchpad-gestures.backend.js').TouchpadGestures;
export const TouchpadGestures = serviceClass<typeof import('./touchpad-gestures.backend.js').TouchpadGestures>('settings/touchpad-gestures.TouchpadGestures', {}, []);
