import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export interface AccountResult {identity?: {provider: string; name: string; login?: string; id?: number}; clientId?: string; code?: string; url?: string; interval?: number; pending?: boolean;
    system?: {available: boolean; currentUser: string; users: {username: string; name: string; uid: number; home: string; github?: string; githubId?: number}[]; binding?: {id: number; login: string}; firstSetup: boolean};}
export interface AccountControls {request(action: string, clientId?: string, data?: object): Promise<AccountResult>; destroy(): void;}
export type Accounts = import('./accounts.backend.js').Accounts;
export const Accounts = serviceClass<typeof import('./accounts.backend.js').Accounts>('settings/accounts.Accounts', {}, []);
