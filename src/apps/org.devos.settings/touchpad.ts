import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export interface TouchpadValues {tap: boolean; drag: boolean; natural: boolean; typing: boolean; leftHanded: boolean; speed: number;}
export interface TouchpadState {settings: TouchpadValues; devices: string[]; applied: boolean;}
export interface TouchpadControls {request(action: 'get' | 'save' | 'reset', settings?: TouchpadValues): Promise<TouchpadState>; destroy(): void;}
export const defaultTouchpad: TouchpadValues = {tap: true, drag: true, natural: true, typing: true, leftHanded: false, speed: 50};
export type Touchpad = import('./touchpad.backend.js').Touchpad;
export const Touchpad = serviceClass<typeof import('./touchpad.backend.js').Touchpad>('settings/touchpad.Touchpad', {}, []);
