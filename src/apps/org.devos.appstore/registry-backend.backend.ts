import {Gio, GLib, readJson, writeJson, removeTree} from '@dev-os/core/base';
import {packageManagerBinary, type PackageControls, type InstalledPackage, type InstallResult} from './package-backend.backend.js';
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
export class RegistryManager implements RegistryControls {
    busy = false;
    private download?: Gio.Subprocess;
    private directories = new Set<string>();
    private disposed = false;
    private bindings: Bindings = {};
    private pending = new Map<string, {directory: string; registryId: string; prepared: PreparedRegistryPackage}>();
    private readonly bindingPath: string;
    constructor(private readonly packages: PackageControls, private readonly arch?: string, bindingPath?: string) {
        const store = GLib.canonicalize_filename(GLib.getenv('DEV_ROOT') || `${GLib.getenv('XDG_DATA_HOME') || GLib.get_user_data_dir()}/devos`, GLib.get_current_dir());
        const identity = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, store, -1);
        this.bindingPath = bindingPath ?? `${GLib.get_user_data_dir()}/dev-os/app-store/bindings-${identity}.json`;
        if (GLib.file_test(this.bindingPath, GLib.FileTest.EXISTS)) {
            const saved = readJson<unknown>(this.bindingPath);
            if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('App Store package mappings are invalid.');
            for (const [id, name] of Object.entries(saved)) if (/^[a-z0-9][a-z0-9-]*$/.test(id) && typeof name === 'string' && packageName.test(name)) this.bindings[id] = name;
        }
    }
    packageId(id: string): string | undefined {return this.bindings[id];}
    private hostArch(): string {
        if (this.arch) return this.arch;
        const [, output, , status] = GLib.spawn_sync(null, ['uname', '-m'], null, GLib.SpawnFlags.SEARCH_PATH, null);
        if (status !== 0) throw new Error('Cannot determine the system architecture.');
        return new TextDecoder().decode(output!).trim();
    }
    async prepare(app: RegistryApp): Promise<PreparedRegistryPackage> {
        if (this.disposed) throw new Error('App Store closed.');
        if (this.busy || this.packages.busy) throw new Error('Wait for the current package operation to finish.');
        const source = app.registry.download;
        if (!source || !safeWebsite(source.url)) throw new Error('This app has no supported HTTPS download.');
        if (!packageManagerBinary()) throw new Error('The package manager (dev) is not installed or is not available in PATH.');
        const arch = this.hostArch();
        if (!['arm64', 'aarch64'].includes(arch)) throw new Error('This catalog provides Linux ARM64 packages. Use an ARM64 DevOs system.');
        const curl = GLib.find_program_in_path('curl');
        if (!curl) throw new Error('The download service (curl) is not installed.');
        const directory = GLib.dir_make_tmp('devos-app-store-XXXXXX'), path = `${directory}/download.${source.format}`;
        this.directories.add(directory);
        this.busy = true;
        try {
            // A local suffix handles upstream redirect endpoints that PM's URL suffix gate rejects.
            const process = Gio.Subprocess.new([curl, '--disable', '--fail', '--location', '--silent', '--show-error', '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '10', '--connect-timeout', '30', '--max-time', '600', '--max-filesize', '2147483648', '--output', path, '--url', source.url], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            this.download = process;
            await new Promise<void>((resolve, reject) => process.communicate_utf8_async(null, null, (_source, result) => {
                this.download = undefined;
                try {process.communicate_utf8_finish(result); if (!process.get_successful()) throw new Error(`Download failed (${process.get_if_signaled() ? 'cancelled' : `exit ${process.get_exit_status()}`}). Retry or check the publisher website.`); resolve();} catch (error) {reject(error);}
            }));
            const size = Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
            if (size <= 0 || size > 2 * 1024 ** 3) throw new Error('The download must be nonempty and at most 2 GiB.');
            const info = await this.packages.inspect(path);
            validateRegistryPackage(info, arch);
            const existing = (await this.packages.installed()).find(item => item.id === info.id && item.kind === 'app');
            const prepared = {path, info, existing};
            this.pending.set(prepared.path, {directory, registryId: app.registry.id, prepared});
            return prepared;
        } catch (error) {this.directories.delete(directory); removeTree(directory); throw error;} finally {this.busy = false;}
    }
    async install(app: RegistryApp, prepared: PreparedRegistryPackage, progress: (line: string) => void): Promise<InstallResult> {
        const pending = this.pending.get(prepared.path);
        if (!pending || pending.registryId !== app.registry.id) throw new Error('Download and review this app before installation.');
        prepared = pending.prepared;
        if (this.disposed) throw new Error('App Store closed.');
        if (this.busy || this.packages.busy) throw new Error('Wait for the current package operation to finish.');
        this.busy = true;
        try {
            const result = await this.packages.install(prepared.path, progress, {replace: !!prepared.existing});
            const actual = (await this.packages.installed()).find(item => item.id === result.id && item.version === result.version && item.kind === 'app');
            if (!actual || result.id !== prepared.info.id || result.extension) throw new Error('DevOsPM installed a package but its identity could not be confirmed. Check the Packages tab.');
            this.bindings[app.registry.id] = actual.id;
            try {writeJson(this.bindingPath, this.bindings);} catch {progress('Installed, but the App Store mapping could not be saved. Manage the package in Installed or Packages.');}
            return result;
        } finally {this.busy = false; this.discard(prepared);}
    }
    discard(prepared: PreparedRegistryPackage): void {
        const pending = this.pending.get(prepared.path);
        if (pending) {this.pending.delete(prepared.path); this.directories.delete(pending.directory); removeTree(pending.directory);}
    }
    destroy() {this.disposed = true; this.download?.force_exit(); this.download = undefined; for (const directory of this.directories) {try {removeTree(directory);} catch {}} this.directories.clear(); this.pending.clear();}
}
