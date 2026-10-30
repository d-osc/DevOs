import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export interface App {id: string; name: string; description?: string; category?: string; icon?: string; version?: string; origin?: string; package?: string; desktopId?: string; website?: string; removable?: boolean; registry?: import('./registry.js').RegistryDetails; userPackage?: string;}
export interface StoreState {available: boolean; connected: boolean; installed: App[]; catalog: App[]; updates?: App[]; sourceName?: string; message?: string;}
export type Action = 'get' | 'browse' | 'updates' | 'install' | 'remove' | 'update';
export interface StoreControls {busy: boolean; request(action: Action, id?: string): Promise<StoreState>;}
export type AppStore = import('./backend.backend.js').AppStore;
export const AppStore = serviceClass<typeof import('./backend.backend.js').AppStore>('appstore/backend.AppStore', {busy: false}, []);
