import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {inspectPackage, packageKind, type PackageInfo} from './package-file.js';

/** Installs, lists, removes and rolls back user-level packages through `dev`. No root, no package scripts. */
export interface InstalledPackage {id: string; version: string; kind: string; files: number; bytes: number; previousVersion?: string; commands: string[]; description: string; title: string;}
export interface InstallResult {id: string; version: string; path: string; commands: string[]; extension: boolean;}
export interface PackageInstallOptions {replace?: boolean;}
export interface PackageControls {
    busy: boolean;
    inspect(path: string): Promise<PackageInfo>;
    installed(): Promise<InstalledPackage[]>;
    install(path: string, onStage: (line: string) => void, options?: PackageInstallOptions): Promise<InstallResult>;
    remove(id: string): Promise<void>;
    rollback(id: string): Promise<string>;
}
export const PM_ENV = 'DEV_OS_PM';
const ansi = /\x1b\[[0-9;?]*[A-Za-z]|\r/g;
const validatedBinaries = new Map<string, string>();

/** `dev` can also be a DevLang alias. Confirm the CLI before sending package commands. */
export function resolvePackageManager(candidates: (string | null)[]): string | null {
    for (const candidate of new Set(candidates)) {
        if (!candidate || !GLib.file_test(candidate, GLib.FileTest.IS_EXECUTABLE) || !GLib.file_test(candidate, GLib.FileTest.IS_REGULAR)) continue;
        try {
            const file = Gio.File.new_for_path(candidate);
            const stamp = file.query_info('time::modified,time::modified-usec,standard::size', Gio.FileQueryInfoFlags.NONE, null);
            const key = `${stamp.get_attribute_uint64('time::modified')}:${stamp.get_attribute_uint32('time::modified-usec')}:${stamp.get_size()}`;
            if (validatedBinaries.get(candidate) === key) return candidate;
            const process = Gio.Subprocess.new([candidate, '--version'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            const [, output] = process.communicate_utf8(null, null);
            if (process.get_successful() && /^dev \d+\.\d+\.\d+(?:[-+][\w.-]+)?\s*$/.test(output?.trim() || '')) {
                validatedBinaries.set(candidate, key); return candidate;
            }
        } catch { /* Try the next explicit executable location. */ }
    }
    return null;
}

export function packageManagerBinary(): string | null {
    const override = GLib.getenv(PM_ENV);
    if (override) return resolvePackageManager([override]);
    return resolvePackageManager([GLib.find_program_in_path('dev'), `${ROOT}/bin/dev`, `${ROOT}/build/wsl/bin/dev`, `${GLib.get_home_dir()}/.local/bin/dev`, '/usr/local/bin/dev', '/usr/bin/dev']);
}
/** Absolute path so a file named like an option can never be read as one. */
export function absolutePath(path: string): string { return path.startsWith('file:') ? Gio.File.new_for_uri(path).get_path() ?? path : GLib.canonicalize_filename(path, GLib.get_current_dir()); }

/** Parse the lines `dev install` prints: "Installed NAME VERSION", "Path: …", "Run: dev run CMD". */
export function parseInstallOutput(lines: readonly string[]): InstallResult {
    const result: InstallResult = {id: '', version: '', path: '', commands: [], extension: false};
    for (const line of lines) {
        let match = /^Installed Dev OS extension (\S+) (\S+)/.exec(line);
        if (match) { result.id = match[1]; result.version = match[2]; result.extension = true; continue; }
        if ((match = /^Installed (\S+) (\S+)/.exec(line))) { result.id = match[1]; result.version = match[2]; continue; }
        if ((match = /^Path: (.+)$/.exec(line))) { result.path = match[1]; continue; }
        if ((match = /^Run: (?:dev run )?(\S+)/.exec(line))) result.commands.push(match[1]);
    }
    if (!result.id) throw new Error(lines.filter(line => line.startsWith('dev:')).pop()?.replace(/^dev:\s*/, '') ?? 'The package manager did not confirm the installation.');
    return result;
}
export function parseList(json: string): InstalledPackage[] {
    const data = JSON.parse(json || '{}') as {packages?: Record<string, {active: {manifest: Record<string, unknown>; kind?: string; bytes: number; files: Record<string, unknown>}; previous?: {manifest: {version?: string}} | null}>; extensions?: Record<string, {version?: string; bytes?: number; files?: unknown}>};
    const packages = Object.entries(data.packages ?? {}).map(([id, item]) => {
        const manifest = item.active.manifest, bin = manifest.bin as Record<string, string> | undefined;
        return {id, version: String(manifest.version ?? ''), kind: item.active.kind ?? 'app', files: Object.keys(item.active.files ?? {}).length, bytes: item.active.bytes,
            previousVersion: item.previous?.manifest.version, commands: bin ? Object.keys(bin).filter(Boolean).length ? Object.keys(bin).filter(Boolean) : [id] : [],
            description: String(manifest.description ?? ''), title: String(manifest.fullname || manifest.shortname || id)};
    });
    const extensions = Object.entries(data.extensions ?? {}).map(([id, item]) => ({id, version: String(item.version ?? ''), kind: 'extension', files: Array.isArray(item.files) ? item.files.length : 0, bytes: Number(item.bytes ?? 0), commands: [], description: 'Dev OS extension', title: id}));
    return [...packages, ...extensions];
}

export type PackageManagerCli = import('./package-backend.backend.js').PackageManagerCli;
export const PackageManagerCli = serviceClass<typeof import('./package-backend.backend.js').PackageManagerCli>('appstore/package-backend.PackageManagerCli', {busy: false}, []);
