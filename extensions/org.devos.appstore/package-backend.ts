import {Gio, GLib} from '@dev-os/core';
import {inspectPackage, packageKind, type PackageInfo} from './package-file.js';

/** Installs, lists, removes and rolls back user-level packages through `devospm` (DevOsPM). No root, no package scripts. */
export interface InstalledPackage {id: string; version: string; kind: string; files: number; bytes: number; previousVersion?: string; commands: string[]; description: string; title: string;}
export interface InstallResult {id: string; version: string; path: string; commands: string[]; extension: boolean;}
export interface PackageControls {
    busy: boolean;
    inspect(path: string): Promise<PackageInfo>;
    installed(): Promise<InstalledPackage[]>;
    install(path: string, onStage: (line: string) => void): Promise<InstallResult>;
    remove(id: string): Promise<void>;
    rollback(id: string): Promise<string>;
}
export const PM_ENV = 'DEV_OS_PM';
const ansi = /\x1b\[[0-9;?]*[A-Za-z]|\r/g;

export function packageManagerBinary(): string | null {
    const override = GLib.getenv(PM_ENV);
    if (override) return GLib.file_test(override, GLib.FileTest.IS_EXECUTABLE) ? override : null;
    return GLib.find_program_in_path('devospm');
}
/** Absolute path so a file named like an option can never be read as one. */
export function absolutePath(path: string): string { return path.startsWith('file:') ? Gio.File.new_for_uri(path).get_path() ?? path : GLib.canonicalize_filename(path, GLib.get_current_dir()); }

/** Parse the lines `devospm install` prints: "Installed NAME VERSION", "Path: …", "Run: dev run CMD". */
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

export class PackageManagerCli implements PackageControls {
    busy = false;
    private async run(args: string[], onLine?: (line: string) => void): Promise<{status: number; lines: string[]}> {
        const binary = packageManagerBinary();
        if (!binary) throw new Error('The package manager (devospm) is not installed on this system. Install the Dev OS package "devos-pm".');
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE});
        launcher.setenv('NO_COLOR', '1', true); launcher.setenv('TERM', 'dumb', true);
        const process = launcher.spawnv([binary, ...args]), reader = new Gio.DataInputStream({base_stream: process.get_stdout_pipe()!}), lines: string[] = [];
        for (;;) {
            const [line] = await new Promise<[Uint8Array | null, number]>((resolve, reject) => reader.read_line_async(GLib.PRIORITY_DEFAULT, null, (_source, result) => { try { resolve(reader.read_line_finish(result)); } catch (error) { reject(error); } }));
            if (line === null) break;
            const text = new TextDecoder().decode(line).replace(ansi, '').trim(); if (!text) continue;
            lines.push(text); onLine?.(text);
        }
        await new Promise<void>((resolve, reject) => process.wait_async(null, (_source, result) => { try { process.wait_finish(result); resolve(); } catch (error) { reject(error); } }));
        return {status: process.get_exit_status(), lines};
    }
    private async exclusive<T>(work: () => Promise<T>): Promise<T> {
        if (this.busy) throw new Error('Wait for the current operation to finish.');
        this.busy = true;
        try { return await work(); } finally { this.busy = false; }
    }
    inspect(path: string) {
        return new Promise<PackageInfo>((resolve, reject) => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { try { resolve(inspectPackage(absolutePath(path))); } catch (error) { reject(error); } return GLib.SOURCE_REMOVE; }));
    }
    async installed() {
        const {status, lines} = await this.run(['list', '--json']);
        if (status !== 0) throw new Error(lines.join('\n') || 'Could not list packages.');
        return parseList(lines.join('\n'));
    }
    install(path: string, onStage: (line: string) => void) {
        return this.exclusive(async () => {
            const file = absolutePath(path); if (!packageKind(file)) throw new Error('Not a package file.');
            const known = await this.installed().catch(() => [] as InstalledPackage[]), info = await this.inspect(file).catch(() => null);
            const replace = !!info?.id && known.some(item => item.id === info.id);
            const {status, lines} = await this.run(['install', ...(replace ? ['--replace'] : []), file], onStage);
            if (status !== 0) throw new Error(lines.filter(line => line.startsWith('dev:')).map(line => line.replace(/^dev:\s*/, '')).join('\n') || lines.join('\n') || `Installation failed (exit ${status}).`);
            return parseInstallOutput(lines);
        });
    }
    remove(id: string) {
        return this.exclusive(async () => { const {status, lines} = await this.run(['remove', id]); if (status !== 0) throw new Error(lines.join('\n') || `Could not remove ${id}.`); });
    }
    rollback(id: string) {
        return this.exclusive(async () => { const {status, lines} = await this.run(['rollback', id]); if (status !== 0) throw new Error(lines.join('\n') || `Could not roll back ${id}.`); return /to (\S+)/.exec(lines.join(' '))?.[1] ?? ''; });
    }
}
