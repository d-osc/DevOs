import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export interface LanguagePreferences {layouts: string[]; shortcut: string;}
export interface LanguageCatalog {settings: LanguagePreferences; warning?: string; layouts: {id: string; name: string; sample: string}[]; shortcuts: {id: string; name: string}[];}
export interface LanguageControls {load(): Promise<LanguageCatalog>; save(value: LanguagePreferences): Promise<{settings: LanguagePreferences; applied: boolean}>; destroy(): void;}
export type LinuxLanguage = import('./language.backend.js').LinuxLanguage;
export const LinuxLanguage = serviceClass<typeof import('./language.backend.js').LinuxLanguage>('settings/language.LinuxLanguage', {}, []);
