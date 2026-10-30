import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export const systemPages = [
    {id: 'display', title: 'Display', icon: 'video-display-symbolic', description: 'Connected screens, resolution, scaling and arrangement'},
    {id: 'sound', title: 'Sound', icon: 'audio-volume-high-symbolic', description: 'Output volume, mute, input and audio devices'},
    {id: 'power', title: 'Power & battery', icon: 'battery-good-symbolic', description: 'Battery status and supported power profiles'},
    {id: 'storage', title: 'Storage', icon: 'drive-harddisk-symbolic', description: 'Disk usage, available space and your files'},
    {id: 'time', title: 'Date & time', icon: 'preferences-system-time-symbolic', description: 'Time zone, automatic time and the system clock'},
    {id: 'language', title: 'Language', icon: 'input-keyboard-symbolic', description: 'Keyboard languages and switching shortcuts'},
    {id: 'core', title: 'Desktop', icon: 'preferences-desktop-symbolic', description: 'Desktop appearance and session preferences'},
    {id: 'about', title: 'About', icon: 'help-about-symbolic', description: 'DevOs version, device specifications and runtime information'},
] as const;
export type SystemPage = 'system' | 'display' | 'sound' | 'power' | 'storage' | 'about';
export const isSystemPage = (page: string): page is SystemPage => ['system', 'display', 'sound', 'power', 'storage', 'about'].includes(page);
export interface SystemState {
    hardware?: Partial<Record<'manufacturer' | 'model' | 'family' | 'serial' | 'productUuid' | 'machineId' | 'boardVendor' | 'boardModel' | 'biosVendor' | 'biosVersion' | 'biosDate' | 'cpuName' | 'cpuVendor' | 'cpuSockets' | 'coresPerSocket' | 'threadsPerCore' | 'cpuMaxMHz' | 'socFamily' | 'socId' | 'socRevision' | 'bootMode', string>>;
    hostManaged: boolean; hostname: string; os: string; kernel: string; architecture: string; cpu: string; processors: number; memory: number; session: string;
    desktopBuild: Record<string, unknown>;
    storage: {path: string; total: number; used: number; free: number}[];
    batteries: {name: string; status: string; percent: number | null; health?: number | null; cycles?: number | null; minutes?: number | null}[];
    power: {available: boolean; active: string; profiles: string[]; degraded: string; error: string};
    tools: Record<string, boolean>; hostSettings: boolean;
}
export interface SystemControls {load(): Promise<SystemState>; open(page: string, host: boolean): Promise<void>; profile(id: string): Promise<SystemState>; destroy(): void;}
export type LinuxSystem = import('./system.backend.js').LinuxSystem;
export const LinuxSystem = serviceClass<typeof import('./system.backend.js').LinuxSystem>('settings/system.LinuxSystem', {}, []);
export const formatBytes = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
