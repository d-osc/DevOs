import {
    readJson, Listeners, Gio, GLib,
    removeTree, writeJson
} from '@dev-os/core/base';
import {Soup} from '@dev-os/core/soup';
import {run, historyAt, type History, type Installed} from './installed.js';
export {run, historyAt};
import {VERSION, ROOT} from '@dev-os/config';
import {repository, parseRelease, newer, platform, validateArchive, version, type Release, type UpdatePlatform} from './protocol.js';
import {parseSwaylockRelease, parseSwaylockVersion, type DependencyUpdate} from './dependencies.js';
import {parseSums, releaseExtras, type Manifest, type ReleaseExtras} from './manifest.js';
import {parseSystemInfo, parseSystemMeta, systemOffer, type SystemInfo, type SystemOffer} from './system.js';
import {applyPatch, checkSignature, freeBytes, readManifest, sha256, treeBytes, trustedKeys, verifyTree, type Trust} from './package.js';

export type UpdateStatus = 'idle' | 'checking' | 'empty' | 'current' | 'available' | 'downloading' | 'installing' | 'ready' | 'error';
export interface UpdateState {
    status: UpdateStatus; busy: boolean; message: string; error: string; release: Release | null;
    running: string; installed: string; managed: boolean; previous: string | null; checked: string;
    swaylock: DependencyUpdate;
    system: SystemState;
    /** 0..1 while a package is downloading; null otherwise. */
    progress: number | null;
    /** What the update will be installed from: the full package or a smaller patch against the installed version. */
    patch: {from: string; size: number} | null;
    /** 'verified' = SHA256SUMS signature checked against a key shipped with this Dev OS; 'unsigned' = hashes only; '' = not known yet. */
    trust: Trust | '';
    /** Non-empty when updates cannot be installed here (Live USB). Checking and reading notes still work. */
    blocked: string;
    /** The last check could not reach GitHub. */
    offline: boolean;
}
/** Kernel, initramfs, bootloader stub, firmware and system files: installed by the privileged helper, active after a restart. */
export interface SystemState {
    /** The helper answered and this is an installed system (not a Live USB). */
    supported: boolean; reason: string;
    version: string; kernel: string; safeBoot: boolean; signed: boolean;
    offer: SystemOffer | null;
    /** Version waiting for a restart, '' when nothing is pending. */
    pending: string; canRollback: boolean; lastError: string;
    /** The computer must restart to finish a system update or a system rollback. */
    restart: boolean;
}
const NO_SYSTEM: SystemState = {supported: false, reason: '', version: '', kernel: '', safeBoot: false, signed: false, offer: null, pending: '', canRollback: false, lastError: '', restart: false};
export interface UpdateTransport {
    get(url: string, cancel: Gio.Cancellable): Promise<{status: number; body: unknown; headers?: Record<string, string>}>;
    download(release: Pick<Release, 'url' | 'size'>, path: string, cancel: Gio.Cancellable): Promise<void>;
}
export interface UpdateOptions {
    repository(): string; root?: string; transport?: UpdateTransport; running?: string;
    /** Test hooks. */
    live?(): boolean; keyDir?: string;
    /** Command that runs devos-system-update (default: dev-os-system-update, which asks for administrator approval). */
    systemCommand?: string[]; reboot?(): Promise<void>; freeBytes?(directory: string): Promise<number>;
}
export const LIVE_MESSAGE = 'Live USB is not updated in place: its system image is read-only and changes in memory are lost at shutdown. Write a newer Dev OS image to the USB stick instead.';
export class GitHubTransport implements UpdateTransport {
    private session = new Soup.Session({timeout: 20, user_agent: 'DevOS-Updater'});
    get(url: string, cancel: Gio.Cancellable): Promise<{status: number; body: unknown; headers?: Record<string, string>}> {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', url);
            if (!message) { reject(new Error('Invalid update URL')); return; }
            message.get_request_headers().append('Accept', 'application/vnd.github+json');
            message.get_request_headers().append('X-GitHub-Api-Version', '2022-11-28');
            this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancel, (_source, result) => {
                try {
                    const data = this.session.send_and_read_finish(result).get_data()!;
                    if (data.length > 4 * 1024 * 1024) throw new Error('GitHub response is too large');
                    const headers: Record<string, string> = {}, response = message.get_response_headers();
                    for (const name of ['x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) { const value = response.get_one(name); if (value) headers[name] = value; }
                    resolve({status: message.get_status(), body: JSON.parse(new TextDecoder().decode(data)), headers});
                } catch (error) { reject(error); }
            });
        });
    }
    async download(release: Pick<Release, 'url' | 'size'>, path: string, cancel: Gio.Cancellable) {
        await run(['curl', '--fail', '--location', '--silent', '--show-error', '--proto', '=https', '--proto-redir', '=https',
            '--connect-timeout', '15', '--max-time', '300', '--max-filesize', String(release.size), '--output', path, release.url], cancel, 310);
    }
}
export {removeTree} from '@dev-os/core/base';
class Offline extends Error {}
interface Adoption {
    unpack: string; key: string; version: string; repository: string; platform: UpdatePlatform;
}
export class Updates {
    state: UpdateState;
    private listeners = new Listeners();
    private cancel = new Gio.Cancellable();
    private disposed = false;
    private history: History = {current: null, previous: null};
    private transport: UpdateTransport;
    private restartNeeded = false;
    private extras: ReleaseExtras = {sums: null, signature: null, patch: null, system: null};
    readonly root: string;
    constructor(private options: UpdateOptions) {
        this.root = options.root ?? `${GLib.get_user_data_dir()}/dev-os-updates`;
        this.transport = options.transport ?? new GitHubTransport();
        let historyError = '';
        try { this.history = historyAt(this.root); }
        catch (error) { historyError = `Cannot read installed updates: ${String(error)}`; }
        const running = options.running ?? VERSION;
        const live = options.live ? options.live() : GLib.file_test('/run/devos-live', GLib.FileTest.IS_DIR);
        this.state = {status: 'idle', busy: false, error: '', message: live ? LIVE_MESSAGE : 'Check for the latest stable release.', release: null,
            running, installed: this.history.current?.version ?? running, managed: Boolean(this.history.current), previous: this.history.previous?.version ?? null, checked: '',
            swaylock: {installed: null, latest: null, available: false, error: ''},
            system: NO_SYSTEM, progress: null, patch: null, trust: '', blocked: live ? LIVE_MESSAGE : '', offline: false};
        if (historyError) this.fail(historyError);
        else if (this.canUseInstalled) this.update({status: 'ready', message: `Dev OS ${this.state.installed} is installed. Restart the shell to use it.`});
    }
    subscribe(listener: () => void) { return this.listeners.subscribe(listener); }
    get canInstall() {
        const release = this.state.release;
        return Boolean(!this.state.blocked && release && (newer(release.version, this.state.installed) || (!this.state.managed && release.version === this.state.running)));
    }
    get selectedRoot(): string | null {
        const current = this.history.current;
        return current ? `${this.root}/releases/${current.key}` : null;
    }
    get canUseInstalled() { return Boolean(this.selectedRoot && (this.state.installed !== this.state.running || this.selectedRoot !== ROOT)); }
    get keyDir() { return this.options.keyDir ?? `${ROOT}/data/update-keys`; }
    async useInstalled(restart: (root: string) => Promise<void>) {
        if (this.state.busy || this.disposed) return;
        this.update({busy: true, error: '', message: 'Preparing to switch to the installed version…'});
        try {
            this.history = historyAt(this.root);
            const root = this.selectedRoot;
            if (!root) throw new Error('Install a release before switching versions');
            await restart(root);
        } catch (error) { this.fail(error); }
        finally { this.update({busy: false}); }
    }
    private update(next: Partial<UpdateState>) {
        if (this.disposed) return;
        this.state = {...this.state, ...next}; this.listeners.emit();
    }
    /** Check only when the last successful check is older than `hours`. For the optional background check. */
    async checkIfDue(hours: number): Promise<boolean> {
        if (this.state.busy || this.disposed || this.state.blocked) return false;
        const stamp = `${this.root}/last-check.json`;
        try {
            if (GLib.file_test(stamp, GLib.FileTest.EXISTS)) {
                const at = Date.parse(String((readJson(stamp) as {at?: string}).at));
                if (Number.isFinite(at) && Date.now() - at < hours * 3600 * 1000) return false;
            }
        } catch { /* An unreadable stamp just means: check now. */ }
        await this.check();
        return true;
    }
    async check(): Promise<void> {
        if (this.state.busy || this.disposed) return;
        this.cancel = new Gio.Cancellable();
        this.update({status: 'checking', busy: true, error: '', offline: false, message: 'Checking GitHub Releases…', release: null, patch: null, trust: '', system: {...this.state.system, offer: null}});
        try {
            this.history = historyAt(this.root);
            this.update({installed: this.history.current?.version ?? this.state.running, managed: Boolean(this.history.current), previous: this.history.previous?.version ?? null});
            const repo = repository(this.options.repository());
            const target = platform(await run(['uname', '-m'], this.cancel));
            const response = await this.fetch(`https://api.github.com/repos/${repo}/releases/latest`);
            if (response.status === 404) {
                const project = await this.fetch(`https://api.github.com/repos/${repo}`);
                if (project.status !== 200) throw new Error('Repository is unavailable or private. Use a public GitHub repository.');
                this.update({status: 'empty', message: 'No published releases yet. Publish a stable release with a Dev OS package.'});
            } else {
                if (response.status !== 200) throw new Error(response.status === 403 || response.status === 429 ? this.rateLimited(response.headers) : `GitHub returned HTTP ${response.status}`);
                const release = parseRelease(response.body, repo, target);
                this.extras = releaseExtras(response.body, repo, target, this.state.managed ? this.state.installed : null);
                const available = newer(release.version, this.state.installed) || (!this.state.managed && release.version === this.state.running);
                const patch = available && this.extras.patch && this.state.managed ? {from: this.extras.patch.from, size: this.extras.patch.size} : null;
                const blocked = this.state.blocked;
                await this.checkSystem();
                this.update({release, patch, status: available ? 'available' : this.canUseInstalled ? 'ready' : 'current',
                    message: available ? (blocked ? `Dev OS ${release.version} is available. ${blocked}` : `Dev OS ${release.version} is available.`)
                        : this.canUseInstalled ? `Dev OS ${this.state.installed} is installed. Restart the shell to use it.` : 'You have the latest stable version.'});
            }
            this.update({checked: new Date().toISOString()});
            try { if (GLib.mkdir_with_parents(this.root, 0o700) === 0) writeJson(`${this.root}/last-check.json`, {at: this.state.checked}); } catch { /* Only used by the optional periodic check. */ }
        } catch (error) {
            if (error instanceof Offline) this.update({offline: true, status: 'error', error: error.message,
                message: 'No internet connection. You can apply an update file from a USB stick or the Downloads folder instead.'});
            else this.fail(error);
        }
        finally { if (!this.state.offline) await this.checkSwaylock(); this.update({busy: false}); }
    }
    private async fetch(url: string) {
        try { return await this.transport.get(url, this.cancel); }
        catch (error) {
            if (this.cancel.is_cancelled()) throw error;
            throw new Offline(`Cannot reach GitHub (${error instanceof Error ? error.message : String(error)}). Check your internet connection and try again.`);
        }
    }
    private rateLimited(headers?: Record<string, string>) {
        const reset = Number(headers?.['x-ratelimit-reset']);
        if (Number.isFinite(reset) && reset > 0) return `GitHub rate limit reached. Try again after ${new Date(reset * 1000).toLocaleTimeString()}.`;
        return 'GitHub rate limit reached. Try again later.';
    }
    private async checkSwaylock(): Promise<void> {
        if (this.disposed || this.cancel.is_cancelled()) return;
        let installed: string | null = null;
        try {
            if (GLib.find_program_in_path('swaylock'))
                installed = parseSwaylockVersion(await run(['swaylock', '--version'], this.cancel, 10));
            const response = await this.transport.get('https://api.github.com/repos/swaywm/swaylock/releases/latest', this.cancel);
            if (response.status !== 200) throw new Error(`swaylock releases returned HTTP ${response.status}`);
            const latest = parseSwaylockRelease(response.body);
            this.update({swaylock: {installed, latest, available: installed === null || newer(latest, installed), error: ''}});
        } catch (error) {
            this.update({swaylock: {installed, latest: null, available: false,
                error: error instanceof Error ? error.message : String(error)}});
        }
    }
    private fail(error: unknown) { this.update({status: 'error', error: error instanceof Error ? error.message : String(error), message: 'The update could not be completed.', progress: null}); }
    private lock(): Gio.File {
        if (GLib.mkdir_with_parents(`${this.root}/releases`, 0o700) !== 0) throw new Error('Cannot create the update directory');
        const lock = Gio.File.new_for_path(`${this.root}/install.lock`);
        try { lock.create(Gio.FileCreateFlags.PRIVATE, null).close(null); }
        catch { throw new Error('Another update is in progress. If an interrupted update left install.lock behind, remove it after closing Dev OS.'); }
        return lock;
    }
    /** Staging left behind by an interrupted installation. Called with the lock held; it never touches an activated release. */
    private cleanLeftovers() {
        for (const directory of [this.root, `${this.root}/releases`]) {
            const children = Gio.File.new_for_path(directory).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            const stale: string[] = [];
            try { for (let child = children.next_file(null); child; child = children.next_file(null)) if (/^\.(staging|verify)-/.test(child.get_name())) stale.push(`${directory}/${child.get_name()}`); }
            finally { children.close(null); }
            for (const path of stale) removeTree(path);
        }
    }
    /** Keep the selected and the previous release, plus whatever this session runs from. */
    private prune() {
        const keep = new Set([this.history.current?.key, this.history.previous?.key]);
        const children = Gio.File.new_for_path(`${this.root}/releases`).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        const stale: string[] = [];
        try { for (let child = children.next_file(null); child; child = children.next_file(null)) {
            const name = child.get_name(), path = `${this.root}/releases/${name}`;
            if (/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(name) && !keep.has(name) && path !== ROOT) stale.push(path);
        } } finally { children.close(null); }
        for (const path of stale) { try { removeTree(path); } catch { /* Space is only reclaimed on a best-effort basis. */ } }
    }
    private activate(record: Installed, previous: Installed | null) {
        // One atomic JSON replacement is the commit point used by the session launcher.
        writeJson(`${this.root}/history.json`, {current: record, previous});
        const link = `${this.root}/current`, temporary = `${this.root}/current-${GLib.uuid_string_random()}`;
        try {
            Gio.File.new_for_path(temporary).make_symbolic_link(`releases/${record.key}`, null);
            Gio.File.new_for_path(temporary).move(Gio.File.new_for_path(link), Gio.FileCopyFlags.OVERWRITE, null, null);
        } catch { /* This convenience symlink is not the authoritative session selection. */ }
        finally { try { if (GLib.file_test(temporary, GLib.FileTest.IS_SYMLINK)) Gio.File.new_for_path(temporary).delete(null); } catch { /* Selection already committed. */ } }
        this.history = {current: record, previous};
        this.update({status: 'ready', installed: record.version, managed: true, previous: previous?.version ?? null, progress: null, patch: null,
            message: `Dev OS ${record.version} is installed. Restart the shell to use it.`, error: ''});
    }
    private async space(needed: number) {
        const free = await (this.options.freeBytes ? this.options.freeBytes(this.root) : freeBytes(this.root, this.cancel));
        if (free < needed) throw new Error(`Not enough free disk space: about ${Math.ceil(needed / 1048576)} MB needed in ${this.root}, ${Math.floor(free / 1048576)} MB available. Free some space and try again; the current installation was not changed.`);
    }
    /** Poll the size of a growing download for the progress bar. */
    private async download(url: string, size: number, path: string): Promise<void> {
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            try { this.update({progress: Math.min(1, Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size() / size)}); } catch { /* Not created yet. */ }
            return GLib.SOURCE_CONTINUE;
        });
        try { await this.transport.download({url, size}, path, this.cancel); }
        finally { GLib.Source.remove(timer); }
        const got = Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
        if (got !== size) throw new Error('Downloaded file size does not match the release');
        this.update({progress: 1});
    }
    /** Returns the expected checksums from SHA256SUMS (signature-checked when this Dev OS ships a key). */
    private async trusted(staging: string): Promise<{sums: Map<string, string> | null; trust: Trust}> {
        const keys = trustedKeys(this.keyDir), {sums, signature} = this.extras;
        if (!sums) {
            if (keys.length > 0) throw new Error('This release has no SHA256SUMS, but this Dev OS only installs signed releases. Nothing was changed.');
            return {sums: null, trust: 'unsigned'};
        }
        this.update({message: 'Verifying release checksums…'});
        await this.download(sums.url, sums.size, `${staging}/SHA256SUMS`);
        if (signature) await this.download(signature.url, signature.size, `${staging}/SHA256SUMS.sig`);
        const trust = await checkSignature(`${staging}/SHA256SUMS`, signature ? `${staging}/SHA256SUMS.sig` : null, keys, this.cancel);
        return {sums: parseSums(new TextDecoder().decode(GLib.file_get_contents(`${staging}/SHA256SUMS`)[1])), trust};
    }
    private async transaction(message: string, job: (staging: string) => Promise<void>) {
        this.cancel = new Gio.Cancellable(); let lock: Gio.File | undefined, staging = '';
        this.update({busy: true, status: 'downloading', error: '', progress: null, message});
        try {
            lock = this.lock();
            this.cleanLeftovers();
            this.history = historyAt(this.root);
            staging = `${this.root}/.staging-${GLib.uuid_string_random()}`;
            Gio.File.new_for_path(staging).make_directory(null);
            await job(staging);
        } catch (error) { this.fail(error); }
        finally { this.finish(lock, staging); }
    }
    /** Final checks on an unpacked release tree, then the move into releases/ and the atomic switch. */
    private async adopt(item: Adoption): Promise<Manifest | null> {
        const {unpack} = item;
        const metadata = readJson<Record<string, unknown>>(`${unpack}/release.json`);
        if (metadata.format !== 1 || metadata.version !== item.version || metadata.platform !== item.platform)
            throw new Error('Package metadata does not match the selected release');
        for (const name of ['dev-os-session', 'dev-os-shell', 'dev-os-start']) {
            if (!GLib.file_test(`${unpack}/bin/${name}`, GLib.FileTest.IS_EXECUTABLE)) throw new Error('Update session commands are not executable');
        }
        if (!GLib.file_test(`${unpack}/native/dev-os-window-tracker`, GLib.FileTest.IS_EXECUTABLE)) throw new Error('Window tracker is not executable');
        // Packages from before manifests existed are still accepted when their archive hash was verified.
        const manifest = await readManifest(unpack);
        if (manifest) {
            if (manifest.version !== item.version || manifest.platform !== item.platform) throw new Error('Package manifest does not match the selected release');
            const installed = this.history.current?.version ?? this.state.running;
            if (newer(manifest.minCompatible, installed)) throw new Error(`This update needs Dev OS ${manifest.minCompatible} or newer first (installed: ${installed}). Install the intermediate release, then try again.`);
            this.update({status: 'installing', message: 'Verifying every file against the package manifest…'});
            await verifyTree(unpack, manifest, this.cancel);
        }
        const target = `${this.root}/releases/${item.key}`;
        if (GLib.file_test(target, GLib.FileTest.EXISTS)) throw new Error('This release directory already exists; use rollback or inspect the previous installation.');
        this.update({status: 'installing', message: 'Switching to the new version…'});
        Gio.File.new_for_path(unpack).move(Gio.File.new_for_path(target), Gio.FileCopyFlags.NONE, null, null);
        this.activate({key: item.key, version: item.version, repository: item.repository, platform: item.platform}, this.history.current);
        try { this.prune(); } catch { /* Old releases are only reclaimed best-effort. */ }
        return manifest;
    }
    private async fullPackage(archive: string, item: Omit<Adoption, 'unpack'>): Promise<void> {
        this.update({status: 'installing', message: 'Verifying and installing the update…'});
        const names = await run(['tar', '-tzf', archive, '--quoting-style=escape'], this.cancel);
        const details = await run(['tar', '-tvzf', archive, '--numeric-owner', '--quoting-style=escape'], this.cancel);
        validateArchive(names, details);
        const unpack = `${this.root}/releases/.staging-${GLib.uuid_string_random()}`;
        Gio.File.new_for_path(unpack).make_directory(null);
        try {
            await run(['tar', '-xzf', archive, '-C', unpack, '--strip-components=1', '--no-same-owner', '--no-same-permissions'], this.cancel, 300);
            await this.adopt({...item, unpack});
        } finally { removeTree(unpack); }
    }
    private async patchPackage(archive: string, item: Omit<Adoption, 'unpack'>): Promise<void> {
        const base = this.selectedRoot;
        if (!base || !this.history.current) throw new Error('A patch needs an installed Dev OS version to patch.');
        this.update({status: 'installing', message: 'Applying the patch to a copy of the installed version…'});
        const unpack = `${this.root}/releases/.staging-${GLib.uuid_string_random()}`;
        try {
            const {meta} = await applyPatch(archive, base, unpack, this.cancel);
            if (meta.to !== item.version || meta.platform !== item.platform) throw new Error('The patch does not lead to the selected release');
            if (meta.from !== this.history.current.version) throw new Error('The patch is not for the installed version');
            await this.adopt({...item, unpack});
        } finally { removeTree(unpack); }
    }
    async install(): Promise<void> {
        const release = this.state.release;
        if (!release || this.state.busy || this.disposed || !this.canInstall) return;
        await this.transaction(`Downloading Dev OS ${release.version}…`, async staging => {
            if (!(newer(release.version, this.history.current?.version ?? this.state.running) || (!this.history.current && release.version === this.state.running)))
                throw new Error('This version or a newer one was already installed. Check for updates again.');
            const key = `${release.version}-${release.sha256.slice(0, 12)}`;
            if (this.history.previous?.key === key && this.history.previous.repository === release.repository) {
                this.activate(this.history.previous, this.history.current); return;
            }
            const item = {key, version: release.version, repository: release.repository, platform: release.platform};
            const {sums, trust} = await this.trusted(staging);
            this.update({trust});
            const fullName = `dev-os-${release.platform}.tar.gz`;
            // Two independent sources must agree: the GitHub API digest and the (signed) SHA256SUMS of the same release.
            if (sums && sums.get(fullName) !== release.sha256) throw new Error('SHA256SUMS does not match the release package. The current installation was kept.');
            const patch = this.state.managed ? this.extras.patch : null;
            if (patch && (!sums || sums.has(patch.name))) {
                const expected = sums?.get(patch.name) ?? patch.sha256;
                try {
                    if (!expected) throw new Error('The patch has no checksum');
                    await this.space(4 * patch.size + await treeBytes(this.selectedRoot!, this.cancel) + 32 * 1048576);
                    const file = `${staging}/patch.tar.gz`;
                    this.update({message: `Downloading a ${(patch.size / 1048576).toFixed(1)} MB patch from ${patch.from}…`});
                    await this.download(patch.url, patch.size, file);
                    if ((await sha256(file, this.cancel)) !== expected) throw new Error('SHA-256 verification of the patch failed');
                    await this.patchPackage(file, item); return;
                } catch (error) {
                    if (this.cancel.is_cancelled()) throw error;
                    // A patch is only an optimisation: the full package is verified on its own.
                    this.update({message: `The patch could not be used (${error instanceof Error ? error.message : String(error)}). Downloading the full package…`, patch: null, progress: null});
                }
            }
            await this.space(4 * release.size + 32 * 1048576);
            const archive = `${staging}/package.tar.gz`;
            this.update({message: `Downloading Dev OS ${release.version}…`});
            await this.download(release.url, release.size, archive);
            this.update({message: 'Verifying the download…'});
            const hash = await sha256(archive, this.cancel);
            if (hash !== release.sha256) throw new Error('SHA-256 verification failed. The current installation was kept.');
            await this.fullPackage(archive, item);
        });
    }
    /** Install an update package (full `dev-os-linux-<arch>.tar.gz` or a patch) that the user already has, for machines without internet. */
    async installFile(path: string): Promise<void> {
        if (this.state.busy || this.disposed) return;
        if (this.state.blocked) { this.fail(this.state.blocked); return; }
        await this.transaction('Reading the update file…', async staging => {
            if (!path.startsWith('/') || !GLib.file_test(path, GLib.FileTest.IS_REGULAR) || !/\.tar\.gz$/.test(path)) throw new Error('Choose an update file ending in .tar.gz (dev-os-linux-<arch>.tar.gz or a dev-os-patch-… file).');
            const size = Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
            if (size <= 0 || size > 256 * 1024 * 1024) throw new Error('The update file is empty or too large');
            await this.space(5 * size + 32 * 1048576);
            // Work on a private copy so a USB stick being unplugged or edited cannot change what was verified.
            const archive = `${staging}/package.tar.gz`;
            Gio.File.new_for_path(path).copy(Gio.File.new_for_path(archive), Gio.FileCopyFlags.NONE, null, null);
            const hash = await sha256(archive, this.cancel), name = path.slice(path.lastIndexOf('/') + 1);
            const keys = trustedKeys(this.keyDir), directory = path.slice(0, path.lastIndexOf('/'));
            let trust: Trust = 'unsigned';
            const sidecar = `${directory}/SHA256SUMS`;
            if (GLib.file_test(sidecar, GLib.FileTest.IS_REGULAR)) {
                const copy = `${staging}/SHA256SUMS`, sig = `${staging}/SHA256SUMS.sig`;
                Gio.File.new_for_path(sidecar).copy(Gio.File.new_for_path(copy), Gio.FileCopyFlags.NONE, null, null);
                const hasSig = GLib.file_test(`${sidecar}.sig`, GLib.FileTest.IS_REGULAR);
                if (hasSig) Gio.File.new_for_path(`${sidecar}.sig`).copy(Gio.File.new_for_path(sig), Gio.FileCopyFlags.NONE, null, null);
                trust = await checkSignature(copy, hasSig ? sig : null, keys, this.cancel);
                const expected = parseSums(new TextDecoder().decode(GLib.file_get_contents(copy)[1])).get(name);
                if (expected !== hash) throw new Error(`${name} is not listed in SHA256SUMS with this checksum. The file may be damaged or from another release. Nothing was changed.`);
            } else if (keys.length > 0) {
                throw new Error('This Dev OS only installs signed updates. Copy SHA256SUMS and SHA256SUMS.sig from the same GitHub release next to the update file and try again.');
            }
            this.update({trust});
            const first = (await run(['sh', '-c', 'tar -tzf "$1" | head -n 1', 'sh', archive], this.cancel)).trim();
            if (first.startsWith('dev-os-system')) { await this.applySystem(archive, name, hash, staging); return; }
            const machine = platform(await run(['uname', '-m'], this.cancel));
            const key = (to: string) => `${to}-${hash.slice(0, 12)}`;
            if (first.startsWith('dev-os-patch')) {
                const manifestText = await run(['tar', '-xzOf', archive, 'dev-os-patch/patch.json'], this.cancel);
                const meta = JSON.parse(manifestText) as {from?: string; to?: string; platform?: string};
                const to = version(meta.to);
                if (meta.platform !== machine) throw new Error(`This patch is for ${meta.platform}; this computer needs ${machine}.`);
                this.assertNewer(to);
                await this.patchPackage(archive, {key: key(to), version: to, repository: 'local/file', platform: machine});
            } else {
                const metadata = JSON.parse(await run(['tar', '-xzOf', archive, 'dev-os/release.json'], this.cancel)) as {version?: string; platform?: string};
                const to = version(metadata.version);
                if (metadata.platform !== machine) throw new Error(`This package is for ${metadata.platform}; this computer needs ${machine}.`);
                this.assertNewer(to);
                await this.fullPackage(archive, {key: key(to), version: to, repository: 'local/file', platform: machine});
            }
        });
    }
    private assertNewer(to: string) {
        const installed = this.history.current?.version ?? this.state.running;
        if (!newer(to, installed)) throw new Error(`Dev OS ${to} is not newer than the installed ${installed}. To go back to an older version use "Use previous version".`);
    }
    private command(args: string[]): string[] {
        return [...(this.options.systemCommand ?? [GLib.find_program_in_path('dev-os-system-update') ?? `${ROOT}/bin/dev-os-system-update`]), ...args];
    }
    private helper(args: string[], seconds = 60): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            let process: Gio.Subprocess;
            try { process = Gio.Subprocess.new(this.command(args), Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); }
            catch (error) { reject(error); return; }
            const cancel = this.cancel, cancelled = cancel.connect(() => process.force_exit());
            let timedOut = false;
            const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => { timedOut = true; process.force_exit(); return GLib.SOURCE_REMOVE; });
            process.communicate_utf8_async(null, cancel, (_source, result) => {
                cancel.disconnect(cancelled);
                if (!timedOut) GLib.Source.remove(timer);
                try {
                    const [, out, err] = process.communicate_utf8_finish(result);
                    if (timedOut) throw new Error('The system update took too long and was stopped.');
                    try { resolve(JSON.parse(out ?? '') as Record<string, unknown>); }
                    catch {
                        const text = err?.trim() ?? '';
                        throw new Error(/dismissed|Not authorized|authentication/i.test(text) ? 'Administrator approval was cancelled. Nothing was changed.' : text || 'The system update helper did not answer.');
                    }
                } catch (error) { reject(error); }
            });
        });
    }
    private setSystem(info: SystemInfo) {
        const reason = info.live ? LIVE_MESSAGE : info.machine === 'unsupported' ? 'System updates are not available for this processor.' : '';
        this.update({system: {...this.state.system, supported: reason === '', reason, version: info.version, kernel: info.kernel, safeBoot: info.safeBoot, signed: info.signed,
            pending: info.pending, canRollback: info.canRollback, lastError: info.lastError, restart: info.pending !== '' || this.restartNeeded}});
    }
    /** Ask the helper what is installed (read only, no administrator approval). */
    async refreshSystem(): Promise<void> {
        if (this.disposed) return;
        try { this.setSystem(parseSystemInfo(JSON.stringify(await this.helper(['status'], 30)))); }
        catch (error) { this.update({system: {...NO_SYSTEM, reason: error instanceof Error ? error.message : String(error)}}); }
    }
    /** Is there a newer kernel/firmware/system bundle on the release? Informational: the helper re-checks everything. */
    private async checkSystem(): Promise<void> {
        await this.refreshSystem();
        const bundle = this.extras.system, system = this.state.system;
        if (!bundle || !system.supported || !bundle.sha256) { this.update({system: {...system, offer: null}}); return; }
        const directory = GLib.dir_make_tmp('dev-os-system-meta-XXXXXX');
        try {
            const path = `${directory}/system.json`;
            await this.transport.download({url: bundle.metaUrl, size: bundle.metaSize}, path, this.cancel);
            if (bundle.metaSha256 && (await sha256(path, this.cancel)) !== bundle.metaSha256) throw new Error('The system update description does not match the release.');
            const meta = parseSystemMeta(readJson(path), {platform: platform(await run(['uname', '-m'], this.cancel))});
            this.update({system: {...this.state.system, offer: newer(meta.version, system.version) ? systemOffer(meta) : null}});
        } catch (error) {
            this.update({system: {...this.state.system, offer: null, lastError: `Could not read the system update: ${error instanceof Error ? error.message : String(error)}`}});
        } finally { removeTree(directory); }
    }
    private async applySystem(file: string, name: string, hash: string, staging: string) {
        const sums = GLib.file_test(`${staging}/SHA256SUMS`, GLib.FileTest.IS_REGULAR), sig = GLib.file_test(`${staging}/SHA256SUMS.sig`, GLib.FileTest.IS_REGULAR);
        this.update({status: 'installing', progress: null, message: 'Waiting for administrator approval, then installing the system update…'});
        const result = await this.helper(['apply', '--archive', file, '--name', name, '--sha256', hash,
            ...(sums ? ['--sums', `${staging}/SHA256SUMS`] : []), ...(sig ? ['--sig', `${staging}/SHA256SUMS.sig`] : [])], 1800);
        if (result.ok !== true) throw new Error(String(result.error ?? 'The system update failed.'));
        await this.refreshSystem();
        this.update({status: 'ready', error: '', message: `System update ${String(result.version)} is installed. Restart the computer to finish it.`, system: {...this.state.system, offer: null}});
    }
    /** Download, verify and hand the system bundle to the privileged helper. Takes effect after a restart. */
    async installSystem(): Promise<void> {
        const bundle = this.extras.system, offer = this.state.system.offer;
        if (!bundle || !offer || this.state.busy || this.disposed || this.state.blocked || !this.state.system.supported || this.state.system.pending) return;
        await this.transaction(`Downloading system update ${offer.version}…`, async staging => {
            if (!bundle.sha256) throw new Error('The system update has no SHA-256 digest on GitHub.');
            const {sums, trust} = await this.trusted(staging);
            this.update({trust});
            if (sums && sums.get(bundle.name) !== bundle.sha256) throw new Error('SHA256SUMS does not match the system update. Nothing was changed.');
            await this.space(2 * bundle.size + 64 * 1048576);
            const file = `${staging}/${bundle.name}`;
            await this.download(bundle.url, bundle.size, file);
            this.update({message: 'Verifying the download…'});
            if ((await sha256(file, this.cancel)) !== bundle.sha256) throw new Error('SHA-256 verification of the system update failed. Nothing was changed.');
            await this.applySystem(file, bundle.name, bundle.sha256, staging);
        });
    }
    private async systemAction(action: 'rollback' | 'cancel', message: string) {
        if (this.state.busy || this.disposed) return;
        this.cancel = new Gio.Cancellable();
        this.update({busy: true, error: '', status: 'installing', message: 'Waiting for administrator approval…'});
        try {
            const result = await this.helper([action], 600);
            if (result.ok !== true) throw new Error(String(result.error ?? 'The system update could not be changed.'));
            this.restartNeeded = action === 'rollback';
            await this.refreshSystem();
            this.update({status: 'ready', message});
        } catch (error) { this.fail(error); }
        finally { this.update({busy: false}); }
    }
    /** Undo the last system update; the previous boot image and files return after a restart. */
    rollbackSystem() { return this.systemAction('rollback', 'The previous system is restored. Restart the computer to use it.'); }
    /** Withdraw a system update that is installed but not restarted yet. */
    cancelSystem() { return this.systemAction('cancel', 'The system update was cancelled.'); }
    /** Restart the computer (after a system update). */
    async restartComputer(): Promise<void> {
        if (this.disposed) return;
        try { await (this.options.reboot ? this.options.reboot() : run(['systemctl', 'reboot'], new Gio.Cancellable(), 30)); }
        catch (error) { this.fail(`Could not restart: ${error instanceof Error ? error.message : String(error)}`); }
    }
    /** Versions on this computer, newest role first, for the Updates page. */
    get versions(): {version: string; role: 'running' | 'installed' | 'previous'}[] {
        const rows: {version: string; role: 'running' | 'installed' | 'previous'}[] = [{version: this.state.running, role: 'running'}];
        if (this.history.current) rows.push({version: this.history.current.version, role: 'installed'});
        if (this.history.previous) rows.push({version: this.history.previous.version, role: 'previous'});
        return rows;
    }
    async rollback(): Promise<void> {
        if (!this.history.previous || this.state.busy || this.disposed) return;
        let lock: Gio.File | undefined;
        this.update({busy: true, error: ''});
        try {
            lock = this.lock(); this.history = historyAt(this.root);
            if (!this.history.previous) throw new Error('No previous version is installed');
            this.activate(this.history.previous, this.history.current);
        }
        catch (error) { this.fail(error); }
        finally { this.finish(lock); }
    }
    private finish(lock?: Gio.File, staging = '') {
        try { if (staging) removeTree(staging); } catch (error) { this.fail(`Could not clean the temporary download: ${String(error)}`); }
        try { lock?.delete(null); } catch (error) { this.fail(`Could not release the update lock: ${String(error)}`); }
        this.update({busy: false, progress: null});
    }
    dispose() { this.disposed = true; this.cancel.cancel(); this.listeners.clear(); }
}
