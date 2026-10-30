import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib, readJson, writeJson, removeTree} from '@dev-os/core/base';
import {packageManagerBinary, type PackageControls, type InstalledPackage, type InstallResult} from './package-backend.js';
import type {PackageInfo} from './package-file.js';
import {safeWebsite, type RegistryApp} from './registry.js';

export interface PreparedRegistryPackage {path: string; info: PackageInfo; existing?: InstalledPackage;}
export interface RegistryControls {
    busy: boolean;
    packageId(id: string): string | undefined;
    prepare(app: RegistryApp): Promise<PreparedRegistryPackage>;
    install(app: RegistryApp, prepared: PreparedRegistryPackage, progress: (line: string) => void): Promise<InstallResult>;
    discard(prepared: PreparedRegistryPackage): void;
}
type Bindings = Record<string, string>;
const packageName = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export function validateRegistryPackage(info: PackageInfo, arch: string): void {
    if (!['aarch64', 'arm64'].includes(arch)) throw new Error('This catalog provides Linux ARM64 packages. Use an ARM64 DevOs system.');
    if (info.blockers.length) throw new Error(info.blockers.join('\n'));
    if (!info.id || !packageName.test(info.id)) throw new Error('Cannot determine a valid DevOsPM package name from the downloaded file.');
    if (info.packageKind === 'extension') throw new Error('An application download must not install an extension.');
    if (['deb', 'rpm'].includes(info.kind) && !info.arch) throw new Error('The downloaded package does not declare its architecture.');
    if (info.arch && !['arm64', 'aarch64', 'all', 'noarch'].includes(info.arch)) throw new Error(`The downloaded package targets ${info.arch}, not ARM64.`);
}

/** Download and review upstream bytes; DevOsPM owns installation and installed state. */
export type RegistryManager = import('./registry-backend.backend.js').RegistryManager;
export const RegistryManager = serviceClass<typeof import('./registry-backend.backend.js').RegistryManager>('appstore/registry-backend.RegistryManager', {busy: false, bindings: {}}, ["discard"], {packageId: (snapshot, id: string) => snapshot.bindings[id]});
