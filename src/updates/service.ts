import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {VERSION} from '../config.js';
import {writeJson} from '../preferences.js';
import {repository, version, parseRelease, newer, platform, validateArchive, type Release} from './protocol.js';

export type UpdateStatus = 'idle' | 'checking' | 'empty' | 'current' | 'available' | 'downloading' | 'installing' | 'ready' | 'error';
export interface UpdateState {
    status: UpdateStatus; busy: boolean; message: string; error: string; release: Release | null;
    running: string; installed: string; managed: boolean; previous: string | null; checked: string;
}
interface Installed {key: string; version: string; repository: string; platform: string;}
interface History {current: Installed | null; previous: Installed | null;}
export interface UpdateTransport {
    get(url: string, cancel: Gio.Cancellable): Promise<{status: number; body: unknown}>;
    download(release: Release, path: string, cancel: Gio.Cancellable): Promise<void>;
}
function run(args: string[], cancel: Gio.Cancellable, timeoutSeconds = 60): Promise<string> {
    return new Promise((resolve, reject) => {
        let process: Gio.Subprocess;
        try { process = Gio.Subprocess.new(args, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); }
        catch (error) { reject(error); return; }
        const cancelled = cancel.connect(() => process.force_exit());
        const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => { process.force_exit(); return GLib.SOURCE_REMOVE; });
        let timedOut = false;
        // The timeout is also tracked to avoid removing an already-fired GLib source.
        GLib.Source.set_name_by_id(timeout, 'dev-os-update-process');
        const source = GLib.MainContext.default().find_source_by_id(timeout);
        process.communicate_utf8_async(null, cancel, (_source, result) => {
            if (source && !source.is_destroyed()) source.destroy(); else timedOut = true;
            cancel.disconnect(cancelled);
            try {
                const [, stdout, stderr] = process.communicate_utf8_finish(result);
                if (timedOut) throw new Error('Update operation timed out. Try again.');
                if (!process.get_successful()) throw new Error(stderr?.trim() || `${args[0]} failed`);
                resolve(stdout?.trimEnd() ?? '');
            } catch (error) { reject(error); }
        });
    });
}
class GitHubTransport implements UpdateTransport {
    private session = new Soup.Session({timeout: 20, user_agent: 'DevOS-Updater'});
    get(url: string, cancel: Gio.Cancellable): Promise<{status: number; body: unknown}> {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', url);
            if (!message) { reject(new Error('Invalid update URL')); return; }
            message.get_request_headers().append('Accept', 'application/vnd.github+json');
            message.get_request_headers().append('X-GitHub-Api-Version', '2022-11-28');
            this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancel, (_source, result) => {
                try {
                    const data = this.session.send_and_read_finish(result).get_data()!;
                    if (data.length > 4 * 1024 * 1024) throw new Error('GitHub response is too large');
                    resolve({status: message.get_status(), body: JSON.parse(new TextDecoder().decode(data))});
                } catch (error) { reject(error); }
            });
        });
    }
    async download(release: Release, path: string, cancel: Gio.Cancellable) {
        await run(['curl', '--fail', '--location', '--silent', '--show-error', '--proto', '=https', '--proto-redir', '=https',
            '--connect-timeout', '15', '--max-time', '300', '--max-filesize', String(release.size), '--output', path, release.url], cancel, 310);
    }
}
function read<T>(path: string): T { return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(path)[1])) as T; }
function historyAt(root: string): History {
    if (!GLib.file_test(`${root}/history.json`, GLib.FileTest.EXISTS)) return {current: null, previous: null};
    const history = read<History>(`${root}/history.json`);
    if (!history || !Object.hasOwn(history, 'current') || !Object.hasOwn(history, 'previous')) throw new Error('Invalid installed update history');
    for (const record of [history.current, history.previous]) {
        if (record === null) continue;
        if (!record || typeof record !== 'object' || !['linux-x64', 'linux-arm64'].includes(record.platform))
            throw new Error('Invalid installed update history');
        if (!/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(record.key) || !record.key.startsWith(`${version(record.version)}-`))
            throw new Error('Invalid installed update history');
        repository(record.repository);
        const metadata = read<Record<string, unknown>>(`${root}/releases/${record.key}/release.json`);
        if (metadata.format !== 1 || metadata.version !== record.version || metadata.platform !== record.platform)
            throw new Error('Installed release metadata does not match update history');
    }
    return history;
}
function removeTree(path: string) {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null)) return;
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
        const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        try { for (let child = children.next_file(null); child; child = children.next_file(null)) removeTree(`${path}/${child.get_name()}`); }
        finally { children.close(null); }
    }
    file.delete(null);
}
export class Updates {
    state: UpdateState;
    private listeners = new Set<() => void>();
    private cancel = new Gio.Cancellable();
    private disposed = false;
    private history: History = {current: null, previous: null};
    private transport: UpdateTransport;
    readonly root: string;
    constructor(private options: {repository(): string; root?: string; transport?: UpdateTransport; running?: string}) {
        this.root = options.root ?? `${GLib.get_user_data_dir()}/dev-os-updates`;
        this.transport = options.transport ?? new GitHubTransport();
        let historyError = '';
        try { this.history = historyAt(this.root); }
        catch (error) { historyError = `Cannot read installed updates: ${String(error)}`; }
        const running = options.running ?? VERSION;
        this.state = {status: 'idle', busy: false, error: '', message: 'Check for the latest stable release.', release: null,
            running, installed: this.history.current?.version ?? running, managed: Boolean(this.history.current), previous: this.history.previous?.version ?? null, checked: ''};
        if (historyError) this.fail(historyError);
    }
    subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    get canInstall() {
        const release = this.state.release;
        return Boolean(release && (newer(release.version, this.state.installed) || (!this.state.managed && release.version === this.state.running)));
    }
    private update(next: Partial<UpdateState>) {
        if (this.disposed) return;
        this.state = {...this.state, ...next}; for (const listener of this.listeners) listener();
    }
    async check(): Promise<void> {
        if (this.state.busy || this.disposed) return;
        this.cancel = new Gio.Cancellable();
        this.update({status: 'checking', busy: true, error: '', message: 'Checking GitHub Releases…', release: null});
        try {
            this.history = historyAt(this.root);
            this.update({installed: this.history.current?.version ?? this.state.running, managed: Boolean(this.history.current), previous: this.history.previous?.version ?? null});
            const repo = repository(this.options.repository());
            const target = platform(await run(['uname', '-m'], this.cancel));
            const response = await this.transport.get(`https://api.github.com/repos/${repo}/releases/latest`, this.cancel);
            if (response.status === 404) {
                const project = await this.transport.get(`https://api.github.com/repos/${repo}`, this.cancel);
                if (project.status !== 200) throw new Error('Repository is unavailable or private. Use a public GitHub repository.');
                this.update({status: 'empty', message: 'No published releases yet. Publish a stable release with a Dev OS package.'});
            } else {
                if (response.status !== 200) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub rate limit reached. Try again later.' : `GitHub returned HTTP ${response.status}`);
                const release = parseRelease(response.body, repo, target);
                const available = newer(release.version, this.state.installed) || (!this.state.managed && release.version === this.state.running);
                this.update({release, status: available ? 'available' : 'current', message: available ? `Dev OS ${release.version} is available.` : 'You have the latest stable version.'});
            }
            this.update({checked: new Date().toISOString()});
        } catch (error) { this.fail(error); }
        finally { this.update({busy: false}); }
    }
    private fail(error: unknown) { this.update({status: 'error', error: error instanceof Error ? error.message : String(error), message: 'The update could not be completed.'}); }
    private lock(): Gio.File {
        if (GLib.mkdir_with_parents(`${this.root}/releases`, 0o700) !== 0) throw new Error('Cannot create the update directory');
        const lock = Gio.File.new_for_path(`${this.root}/install.lock`);
        try { lock.create(Gio.FileCreateFlags.PRIVATE, null).close(null); }
        catch { throw new Error('Another update is in progress. If an interrupted update left install.lock behind, remove it after closing Dev OS.'); }
        return lock;
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
        this.update({status: 'ready', installed: record.version, managed: true, previous: previous?.version ?? null,
            message: `Dev OS ${record.version} is installed. Start a new updated session to use it.`, error: ''});
    }
    async install(): Promise<void> {
        const release = this.state.release;
        if (!release || this.state.busy || this.disposed || !this.canInstall) return;
        this.cancel = new Gio.Cancellable(); let lock: Gio.File | undefined, staging = '';
        this.update({busy: true, status: 'downloading', error: '', message: `Downloading Dev OS ${release.version}…`});
        try {
            lock = this.lock();
            this.history = historyAt(this.root);
            if (!(newer(release.version, this.history.current?.version ?? this.state.running) || (!this.history.current && release.version === this.state.running)))
                throw new Error('This version or a newer one was already installed. Check for updates again.');
            const cachedKey = `${release.version}-${release.sha256.slice(0, 12)}`;
            if (this.history.previous?.key === cachedKey && this.history.previous.repository === release.repository) {
                this.activate(this.history.previous, this.history.current); return;
            }
            staging = GLib.dir_make_tmp('dev-os-update-XXXXXX');
            const archive = `${staging}/package.tar.gz`;
            await this.transport.download(release, archive, this.cancel);
            const size = Gio.File.new_for_path(archive).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
            if (size !== release.size) throw new Error('Downloaded package size does not match the release');
            const hash = (await run(['sha256sum', '--', archive], this.cancel)).split(/\s+/)[0];
            if (hash !== release.sha256) throw new Error('SHA-256 verification failed. The current installation was kept.');
            this.update({status: 'installing', message: 'Verifying and installing the update…'});
            const names = await run(['tar', '-tzf', archive, '--quoting-style=escape'], this.cancel);
            const details = await run(['tar', '-tvzf', archive, '--numeric-owner', '--quoting-style=escape'], this.cancel);
            validateArchive(names, details);
            const key = `${release.version}-${release.sha256.slice(0, 12)}`, target = `${this.root}/releases/${key}`;
            const unpack = `${this.root}/releases/.staging-${GLib.uuid_string_random()}`;
            Gio.File.new_for_path(unpack).make_directory(null);
            try {
                await run(['tar', '-xzf', archive, '-C', unpack, '--strip-components=1', '--no-same-owner', '--no-same-permissions'], this.cancel);
                const metadata = read<Record<string, unknown>>(`${unpack}/release.json`);
                if (metadata.format !== 1 || metadata.version !== release.version || metadata.platform !== release.platform)
                    throw new Error('Package metadata does not match the selected release');
                for (const name of ['dev-os-session', 'dev-os-shell', 'dev-os-start']) {
                    if (!GLib.file_test(`${unpack}/bin/${name}`, GLib.FileTest.IS_EXECUTABLE)) throw new Error('Update session commands are not executable');
                }
                if (!GLib.file_test(`${unpack}/native/dev-os-window-tracker`, GLib.FileTest.IS_EXECUTABLE)) throw new Error('Window tracker is not executable');
                if (GLib.file_test(target, GLib.FileTest.EXISTS)) throw new Error('This release directory already exists; use rollback or inspect the previous installation.');
                Gio.File.new_for_path(unpack).move(Gio.File.new_for_path(target), Gio.FileCopyFlags.NONE, null, null);
                this.activate({key, version: release.version, repository: release.repository, platform: release.platform}, this.history.current);
            } finally { removeTree(unpack); }
        } catch (error) { this.fail(error); }
        finally { this.finish(lock, staging); }
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
        this.update({busy: false});
    }
    dispose() { this.disposed = true; this.cancel.cancel(); this.listeners.clear(); }
}
