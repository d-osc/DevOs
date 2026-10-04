import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {writeJson} from '../preferences.js';
import {newer} from '../updates/protocol.js';
import {GitHubTransport, run, removeTree} from '../updates/service.js';
import {repoInput, extensionAsset, manifestAsset, manifestForRelease, validateExtensionArchive, type ExtensionRelease} from './store-protocol.js';
import {validateExtensionId} from './schema.js';
import type {ExtensionManager} from './manager.js';
import type {Release} from '../updates/protocol.js';

interface Install {key: string; id: string; version: string; repository: string;}
interface Selection extends Install {previous: Install | null;}
export interface StoreItem {repository: string; release: ExtensionRelease | null; installed: Selection | null; error: string; message: string;}
export interface StoreTransport {
    get(url: string, cancel: Gio.Cancellable): Promise<{status: number; body: unknown}>;
    download(release: Pick<Release, 'url' | 'size'>, path: string, cancel: Gio.Cancellable): Promise<void>;
}
export class ExtensionStore {
    items: StoreItem[] = [];
    busy = false;
    error = '';
    message = 'Connect a GitHub repository to discover its latest stable extension release.';
    private listeners = new Set<() => void>();
    private cancel = new Gio.Cancellable();
    private disposed = false;
    private transport: StoreTransport;
    readonly root: string;
    readonly packages: string;
    constructor(private manager: ExtensionManager, options: {root?: string; packages?: string; transport?: StoreTransport} = {}) {
        this.root = options.root ?? `${GLib.get_user_data_dir()}/dev-os/extension-store`;
        this.packages = options.packages ?? `${GLib.get_user_data_dir()}/dev-os/extensions`;
        this.transport = options.transport ?? new GitHubTransport();
        try {
            if (GLib.file_test(`${this.root}/repositories.json`, GLib.FileTest.EXISTS)) {
                const raw: unknown = this.read(`${this.root}/repositories.json`);
                if (!Array.isArray(raw) || raw.length > 100 || raw.some(value => typeof value !== 'string')) throw new Error('Invalid connected repositories');
                this.items = [...new Set((raw as string[]).map(repoInput))].map(repository => this.item(repository));
            }
        } catch (error) { this.error = String(error); }
    }
    private read<T>(path: string): T { return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(path)[1])) as T; }
    private selection(id: string): Selection | null {
        const path = `${this.packages}/${validateExtensionId(id)}`;
        if (!GLib.file_test(`${path}/store-install.json`, GLib.FileTest.EXISTS)) return null;
        const record = this.read<Selection>(`${path}/store-install.json`);
        for (const item of [record, record.previous]) if (item) {
            if (validateExtensionId(item.id) !== id || !/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(item.key) || !item.key.startsWith(`${item.version}-`) || repoInput(item.repository) !== item.repository)
                throw new Error('Invalid extension installation history');
            const manifest = manifestForRelease(this.read(`${this.root}/releases/${id}/${item.key}/extension.json`), item.version, this.protectedIds());
            if (manifest.id !== id) throw new Error('Installed extension ID does not match its history');
        }
        return record;
    }
    private protectedIds() { return this.manager.list().filter(item => item.manifest.system).map(item => item.manifest.id); }
    private item(repository: string): StoreItem {
        const info = this.manager.list().find(info => {
            try { return info.origin === 'user' && this.selection(info.manifest.id)?.repository === repository; } catch { return false; }
        });
        return {repository, release: null, installed: info ? this.selection(info.manifest.id) : null, error: '', message: 'Ready to check releases'};
    }
    subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    private changed() { if (!this.disposed) for (const listener of this.listeners) listener(); }
    private save() { writeJson(`${this.root}/repositories.json`, this.items.map(item => item.repository)); }
    canInstall(item: StoreItem) { return Boolean(item.release && (!item.installed || newer(item.release.version, item.installed.version))); }
    async connect(input: string) {
        if (this.busy || this.disposed) return;
        try {
            const repository = repoInput(input);
            if (this.items.some(item => item.repository === repository)) throw new Error('This repository is already connected');
            if (this.items.length >= 100) throw new Error('At most 100 repositories can be connected');
            this.items.push(this.item(repository));
            try { this.save(); } catch (error) { this.items.pop(); throw error; }
            this.error = ''; this.changed(); await this.check(repository);
        } catch (error) { this.error = error instanceof Error ? error.message : String(error); this.changed(); }
    }
    disconnect(repository: string) {
        if (this.busy || this.disposed) return;
        const previous = this.items;
        try { this.items = this.items.filter(item => item.repository !== repository); this.save(); this.error = ''; }
        catch (error) { this.items = previous; this.error = String(error); }
        this.changed();
    }
    private async fetch(item: StoreItem) {
        item.error = ''; item.release = null;
        try {
            const response = await this.transport.get(`https://api.github.com/repos/${item.repository}/releases/latest`, this.cancel);
            if (response.status !== 200) throw new Error(response.status === 404 ? 'No public stable release found' : `GitHub returned HTTP ${response.status}`);
            const asset = extensionAsset(response.body, item.repository), metadata = manifestAsset(response.body, item.repository);
            const manifestResponse = await this.transport.get(metadata.url, this.cancel);
            if (manifestResponse.status !== 200) throw new Error('Cannot read the release extension.json asset');
            const manifest = manifestForRelease(manifestResponse.body, asset.version, this.protectedIds());
            const duplicate = this.items.find(other => other.repository !== item.repository && (other.installed?.id === manifest.id || other.release?.manifest.id === manifest.id));
            if (duplicate) throw new Error(`Extension ID is already connected from ${duplicate.repository}`);
            if (item.installed && item.installed.id !== manifest.id) throw new Error('A connected repository cannot change its installed extension ID');
            item.release = {...asset, manifest};
            item.message = this.canInstall(item) ? item.installed ? 'Update available' : 'Ready to install' : 'Up to date';
        } catch (error) { item.error = error instanceof Error ? error.message : String(error); item.message = 'Release could not be checked'; }
    }
    async check(repository?: string) {
        if (this.busy || this.disposed) return;
        this.busy = true; this.error = ''; this.cancel = new Gio.Cancellable(); this.message = 'Checking GitHub Releases…'; this.changed();
        try {
            for (const item of this.items.filter(item => !repository || item.repository === repository)) { await this.fetch(item); this.changed(); }
            this.message = 'Release check completed';
        } finally { this.busy = false; this.changed(); }
    }
    private lock() {
        if (GLib.mkdir_with_parents(`${this.root}/releases`, 0o700) !== 0 || GLib.mkdir_with_parents(this.packages, 0o700) !== 0) throw new Error('Cannot create extension directories');
        const file = Gio.File.new_for_path(`${this.root}/install.lock`);
        try { file.create(Gio.FileCreateFlags.PRIVATE, null).close(null); } catch { throw new Error('Another extension installation is in progress'); }
        return file;
    }
    private select(item: StoreItem, record: Install) {
        const target = `${this.packages}/${record.id}`, temporary = `${this.packages}/.store-${GLib.uuid_string_random()}`;
        if (GLib.file_test(target, GLib.FileTest.EXISTS) && !GLib.file_test(target, GLib.FileTest.IS_SYMLINK)) throw new Error('An existing local package owns this extension ID');
        try {
            Gio.File.new_for_path(temporary).make_symbolic_link(`${this.root}/releases/${record.id}/${record.key}`, null);
            Gio.File.new_for_path(temporary).move(Gio.File.new_for_path(target), Gio.FileCopyFlags.OVERWRITE, null, null);
        } finally { if (GLib.file_test(temporary, GLib.FileTest.IS_SYMLINK)) Gio.File.new_for_path(temporary).delete(null); }
        this.manager.reload(); item.installed = this.selection(record.id); item.message = 'Installed · restart the session to load code';
        this.message = `${record.id} ${record.version} installed. Settings are available now; restart the session to load UI changes.`;
    }
    private async operation(item: StoreItem, action: () => Promise<void>) {
        if (this.busy || this.disposed) return;
        this.busy = true; this.error = ''; item.error = ''; this.cancel = new Gio.Cancellable(); this.changed();
        let lock: Gio.File | undefined;
        try { lock = this.lock(); await action(); }
        catch (error) { item.error = error instanceof Error ? error.message : String(error); this.error = item.error; }
        finally { try { lock?.delete(null); } catch (error) { this.error = String(error); } this.busy = false; this.changed(); }
    }
    async install(repository: string) {
        const item = this.items.find(item => item.repository === repository);
        if (!item?.release || !this.canInstall(item)) return;
        const release = item.release;
        await this.operation(item, async () => {
            const id = release.manifest.id, current = this.selection(id);
            if (current && (current.repository !== repository || !newer(release.version, current.version))) throw new Error('Another installation owns this ID or already installed this version');
            if (this.manager.list().some(info => info.manifest.id === id && info.origin === 'user' && !current)) throw new Error('An existing local package owns this extension ID');
            manifestForRelease(release.manifest, release.version, this.protectedIds());
            const staging = GLib.dir_make_tmp('dev-os-extension-XXXXXX');
            const key = `${release.version}-${release.sha256.slice(0, 12)}`, target = `${this.root}/releases/${id}/${key}`;
            let unpack = '';
            try {
                this.message = `Downloading ${release.manifest.name}…`; this.changed();
                const archive = `${staging}/extension.tar.gz`;
                await this.transport.download(release, archive, this.cancel);
                const size = Gio.File.new_for_path(archive).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
                if (size !== release.size || (await run(['sha256sum', '--', archive], this.cancel)).split(/\s+/)[0] !== release.sha256)
                    throw new Error('SHA-256 or size verification failed. The installed extension was kept.');
                validateExtensionArchive(await run(['tar', '-tzf', archive, '--quoting-style=escape'], this.cancel),
                    await run(['tar', '-tvzf', archive, '--numeric-owner', '--quoting-style=escape'], this.cancel), release.manifest);
                GLib.mkdir_with_parents(`${this.root}/releases/${id}`, 0o700);
                unpack = `${this.root}/releases/${id}/.staging-${GLib.uuid_string_random()}`;
                Gio.File.new_for_path(unpack).make_directory(null);
                await run(['tar', '-xzf', archive, '-C', unpack, '--strip-components=1', '--no-same-owner', '--no-same-permissions'], this.cancel);
                const manifest = manifestForRelease(this.read(`${unpack}/extension.json`), release.version, this.protectedIds());
                if (JSON.stringify(manifest) !== JSON.stringify(release.manifest)) throw new Error('Package manifest does not match the release manifest');
                const record: Selection = {key, id, version: release.version, repository, previous: current ? {key: current.key, id, version: current.version, repository} : null};
                writeJson(`${unpack}/store-install.json`, record);
                if (GLib.file_test(target, GLib.FileTest.EXISTS)) {
                    // A verified cached release can be reused after rollback.
                    const cached = this.read<Selection>(`${target}/store-install.json`);
                    if (cached.key !== key || cached.id !== id || cached.repository !== repository) throw new Error('Invalid cached extension release');
                } else Gio.File.new_for_path(unpack).move(Gio.File.new_for_path(target), Gio.FileCopyFlags.NONE, null, null);
                this.select(item, record);
            } finally { try { if (unpack) removeTree(unpack); } finally { removeTree(staging); } }
        });
    }
    async rollback(repository: string) {
        const item = this.items.find(item => item.repository === repository);
        if (!item?.installed) return;
        await this.operation(item, async () => {
            const current = this.selection(item.installed!.id), previous = current?.previous;
            if (current?.repository !== repository) throw new Error('The installed package belongs to another source');
            if (!previous) throw new Error('No previous extension version is installed');
            this.select(item, previous);
        });
    }
    async uninstall(repository: string) {
        const item = this.items.find(item => item.repository === repository);
        if (!item?.installed) return;
        await this.operation(item, async () => {
            const current = this.selection(item.installed!.id);
            if (!current || current.repository !== repository) throw new Error('The installed package belongs to another source');
            const link = Gio.File.new_for_path(`${this.packages}/${current.id}`);
            if (link.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) !== Gio.FileType.SYMBOLIC_LINK) throw new Error('Cannot remove an unmanaged local package');
            link.delete(null); this.manager.reload(); item.installed = null; item.message = 'Removed · restart the session to unload code'; this.message = 'Extension removed. Preferences were preserved.';
        });
    }
    dispose() { this.disposed = true; this.cancel.cancel(); this.listeners.clear(); }
}
