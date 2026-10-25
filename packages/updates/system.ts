// System update bundles (kernel, initramfs, bootloader stub, firmware, modules, system files): the data format shared by the
// release tool, the updater and (as system.list) the privileged helper native/devos-system-update. No GLib here.
import type {UpdatePlatform} from './protocol.js';
import {safePath, type ManifestFile} from './manifest.js';

export type SystemComponent = 'kernel' | 'initramfs' | 'bootloader' | 'firmware' | 'packages';
export const SYSTEM_COMPONENTS: SystemComponent[] = ['kernel', 'initramfs', 'bootloader', 'firmware', 'packages'];
export interface SystemMeta {
    format: 1; kind: 'system'; version: string; platform: UpdatePlatform;
    /** `uname -r` of the bundled kernel, '' when the bundle has no boot image. */
    kernel: string;
    minCompatible: string;
    components: SystemComponent[];
    esp: ManifestFile[]; root: ManifestFile[]; remove: string[];
}
export interface SystemOffer {version: string; kernel: string; components: SystemComponent[]; size: number; minCompatible: string; files: number}
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA = /^[a-f0-9]{64}$/;

export function systemAssetName(platform: UpdatePlatform): string { return `dev-os-system-${platform}.tar.gz`; }
export function systemMetaName(platform: UpdatePlatform): string { return `dev-os-system-${platform}.json`; }
export function okEspPath(path: string): boolean { return /^EFI\/DEVOS\/[A-Za-z0-9._-]+\.EFI$/.test(path); }
export function okRootPath(path: string): boolean {
    return /^usr\/(lib|bin|sbin|libexec|share)\/[A-Za-z0-9._+@/-]+$/.test(path) && !path.includes('..') && !path.includes('//') &&
        path !== 'usr/libexec/devos-system-update' && !path.startsWith('usr/share/polkit-1/') && !path.startsWith('usr/lib/polkit-1/') &&
        !path.startsWith('usr/lib/systemd/system/devos-system-');
}
function file(raw: unknown, area: 'esp' | 'root'): ManifestFile {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid file entry in system update');
    const item = raw as Record<string, unknown>;
    if (typeof item.sha256 !== 'string' || !SHA.test(item.sha256)) throw new Error('Invalid file checksum in system update');
    if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > 1024 * 1024 * 1024) throw new Error('Invalid file size in system update');
    if (item.mode !== '644' && item.mode !== '755') throw new Error('Invalid file mode in system update');
    const path = safePath(item.path);
    if (area === 'esp' ? !okEspPath(path) : !okRootPath(path)) throw new Error(`Path ${path} is not allowed in a system update`);
    return {path, sha256: item.sha256, size: item.size, mode: item.mode};
}
export function parseSystemMeta(raw: unknown, expected?: {platform?: UpdatePlatform}): SystemMeta {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid system update');
    const item = raw as Record<string, unknown>;
    if (item.format !== 1 || item.kind !== 'system') throw new Error('Unsupported system update format');
    if (typeof item.version !== 'string' || !SEMVER.test(item.version)) throw new Error('Invalid system update version');
    if (item.platform !== 'linux-x64' && item.platform !== 'linux-arm64') throw new Error('Invalid system update platform');
    if (expected?.platform && item.platform !== expected.platform) throw new Error('System update is for another platform');
    if (typeof item.kernel !== 'string' || !/^[A-Za-z0-9._+-]*$/.test(item.kernel)) throw new Error('Invalid kernel release in system update');
    if (typeof item.minCompatible !== 'string' || !SEMVER.test(item.minCompatible)) throw new Error('Invalid minimum compatible version in system update');
    const components = Array.isArray(item.components) ? item.components : null;
    if (!components || components.some(name => !(SYSTEM_COMPONENTS as unknown[]).includes(name))) throw new Error('Unknown component in system update');
    const list = (value: unknown, area: 'esp' | 'root') => {
        if (!Array.isArray(value) || value.length > 200000) throw new Error('Invalid file list in system update');
        const result = value.map(entry => file(entry, area));
        if (new Set(result.map(entry => entry.path)).size !== result.length) throw new Error('Duplicate file in system update');
        return result;
    };
    const remove = Array.isArray(item.remove) ? item.remove.map(path => { const safe = safePath(path); if (!okRootPath(safe)) throw new Error(`Path ${safe} is not allowed in a system update`); return safe; }) : null;
    if (!remove) throw new Error('Invalid removal list in system update');
    const esp = list(item.esp, 'esp'), root = list(item.root, 'root');
    if (esp.length > 0 && !esp.some(entry => entry.path === 'EFI/DEVOS/DEVOS.EFI')) throw new Error('A boot image update must contain EFI/DEVOS/DEVOS.EFI');
    return {format: 1, kind: 'system', version: item.version, platform: item.platform, kernel: item.kernel, minCompatible: item.minCompatible,
        components: components as SystemComponent[], esp, root, remove};
}
export function deriveComponents(esp: ManifestFile[], root: ManifestFile[]): SystemComponent[] {
    const result: SystemComponent[] = [];
    if (esp.length > 0) result.push('kernel', 'initramfs', 'bootloader');
    if (root.some(entry => entry.path.startsWith('usr/lib/firmware/'))) result.push('firmware');
    if (root.some(entry => !entry.path.startsWith('usr/lib/firmware/') && !entry.path.startsWith('usr/lib/modules/'))) result.push('packages');
    return result;
}
/** The line format native/devos-system-update reads (it never parses JSON). */
export function systemList(meta: SystemMeta): string {
    const lines = ['format 1', `version ${meta.version}`, `platform ${meta.platform}`, `kernel ${meta.kernel}`, `min ${meta.minCompatible}`, `components ${meta.components.join(' ')}`];
    for (const entry of meta.esp) lines.push(`F esp ${entry.mode} ${entry.sha256} ${entry.size} ${entry.path}`);
    for (const entry of meta.root) lines.push(`F root ${entry.mode} ${entry.sha256} ${entry.size} ${entry.path}`);
    for (const path of meta.remove) lines.push(`R ${path}`);
    return lines.join('\n') + '\n';
}
export function systemOffer(meta: SystemMeta): SystemOffer {
    const files = [...meta.esp, ...meta.root];
    return {version: meta.version, kernel: meta.kernel, components: meta.components, minCompatible: meta.minCompatible,
        size: files.reduce((sum, entry) => sum + entry.size, 0), files: files.length};
}
export interface SystemInfo {
    ok: boolean; version: string; kernel: string; machine: string; live: boolean; efi: boolean; esp: boolean; safeBoot: boolean;
    pending: string; pendingKernel: string; canRollback: boolean; lastError: string; signed: boolean;
}
export function parseSystemInfo(text: string): SystemInfo {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || raw.ok !== true || typeof raw.version !== 'string') throw new Error(typeof raw?.error === 'string' ? raw.error : 'The system update helper did not answer');
    const bool = (value: unknown) => value === true;
    return {ok: true, version: raw.version, kernel: String(raw.kernel ?? ''), machine: String(raw.machine ?? ''), live: bool(raw.live), efi: bool(raw.efi), esp: bool(raw.esp),
        safeBoot: bool(raw.safeBoot), pending: String(raw.pending ?? ''), pendingKernel: String(raw.pendingKernel ?? ''), canRollback: bool(raw.canRollback),
        lastError: String(raw.lastError ?? ''), signed: bool(raw.signed)};
}
