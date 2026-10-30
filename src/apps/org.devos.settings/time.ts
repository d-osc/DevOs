import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export interface TimeState {available: boolean; hostManaged: boolean; timezone: string; ntp: boolean; canNtp: boolean; synchronized: boolean; zones: string[]; error: string;}
export type TimeAction = {action: 'set-timezone'; timezone: string} | {action: 'set-ntp'; enabled: boolean} | {action: 'set-time'; date: string; time: string};
export interface TimeControls {load(): Promise<TimeState>; update(action: TimeAction): Promise<TimeState>; openHostSettings(): Promise<void>; destroy(): void;}
export type LinuxTime = import('./time.backend.js').LinuxTime;
export const LinuxTime = serviceClass<typeof import('./time.backend.js').LinuxTime>('settings/time.LinuxTime', {}, []);
