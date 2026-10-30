import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export interface Disk {name: string; path: string; type: string; size: number; fstype: string | null; label: string | null; mountpoints: (string | null)[]; ro: boolean; model: string | null; tran: string | null; pttype: string | null; fsavail: number | null; fsused: number | null; uuid: string | null; blocked?: string; children?: Disk[];}
export interface DiskState {devices: Disk[]; wsl: boolean;}
export interface DiskControls {request(action: 'get'): Promise<DiskState>; destroy(): void;}
export type Disks = import('./disks.backend.js').Disks;
export const Disks = serviceClass<typeof import('./disks.backend.js').Disks>('diskmanager/disks.Disks', {}, []);
