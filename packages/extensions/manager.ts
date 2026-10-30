import {
    readJson, Listeners, Gio, GLib, writeJson
} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
import {migrateState} from './migrations.js';
import {validateExtensionId, validateManifest, validateState, validateValues} from './schema.js';
import type {ExtensionInfo, SettingsHost, SettingsValues} from './types.js';

export class ExtensionManager implements SettingsHost {
    private extensions = new Map<string, ExtensionInfo>();
    private locations = new Map<string, string>();
    private listeners = new Listeners();
    diagnostics: string[] = [];
    constructor(private paths: {bundled: string; user: string; preferences: string; system?: string; components?: string} = {
        system: `${ROOT}/src/apps`, components: `${ROOT}/src/system`,
        bundled: `${ROOT}/src/extensions`,
        user: `${GLib.get_user_data_dir()}/dev-os/extensions`,
        preferences: `${GLib.get_user_config_dir()}/dev-os/extensions`,
    }) { this.reload(); }
    private file(id: string): string { return `${this.paths.preferences}/${validateExtensionId(id)}.json`; }
    reload(): void {
        const next = new Map<string, ExtensionInfo>();
        const locations = new Map<string, string>();
        this.diagnostics = [];
        const sources: {origin: 'bundled' | 'user'; path: string}[] = [
            ...(this.paths.components ? [{origin: 'bundled' as const, path: this.paths.components}] : []),
            ...(this.paths.system ? [{origin: 'bundled' as const, path: this.paths.system}] : []),
            {origin: 'bundled', path: this.paths.bundled}, {origin: 'user', path: this.paths.user},
        ];
        for (const {origin, path} of sources) {
            const directory = Gio.File.new_for_path(path);
            if (!directory.query_exists(null)) continue;
            let enumerator: Gio.FileEnumerator;
            try { enumerator = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null); }
            catch (reason) { this.diagnostics.push(`${origin}: ${reason instanceof Error ? reason.message : String(reason)}`); continue; }
            try {
                for (let entry = enumerator.next_file(null); entry; entry = enumerator.next_file(null)) {
                    if (entry.get_file_type() !== Gio.FileType.DIRECTORY) continue;
                    // Every package contributes metadata through its JSON manifest.
                    if (!GLib.file_test(`${path}/${entry.get_name()}/extension.json`, GLib.FileTest.EXISTS)) continue;
                    try {
                        const manifest = validateManifest(readJson(`${path}/${entry.get_name()}/extension.json`));
                        if (origin === 'user' && (manifest.system || next.get(manifest.id)?.manifest.system))
                            throw new Error('User packages cannot declare or replace system UI');
                        let state = {version: manifest.settingsVersion, enabled: manifest.enabledByDefault, values: validateValues(manifest, {})};
                        let error: string | undefined;
                        if (GLib.file_test(this.file(manifest.id), GLib.FileTest.EXISTS)) {
                            try { state = validateState(manifest, migrateState(manifest.id, readJson(this.file(manifest.id)))); }
                            catch (reason) { error = reason instanceof Error ? reason.message : String(reason); state.enabled = manifest.system === true; }
                        }
                        next.set(manifest.id, {manifest, origin, state, error});
                        locations.set(manifest.id, `${path}/${entry.get_name()}`);
                        if (error) this.diagnostics.push(`${manifest.id}: ${error}`);
                    } catch (reason) { this.diagnostics.push(`${entry.get_name()}: ${reason instanceof Error ? reason.message : String(reason)}`); }
                }
            } catch (reason) { this.diagnostics.push(`${origin}: ${reason instanceof Error ? reason.message : String(reason)}`); }
            finally { enumerator.close(null); }
        }
        this.extensions = next; this.locations = locations; this.changed();
    }
    list(): ExtensionInfo[] {
        return [...this.extensions.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
            .map(info => JSON.parse(JSON.stringify(info)) as ExtensionInfo);
    }
    get(id: string): ExtensionInfo {
        const info = this.extensions.get(validateExtensionId(id));
        if (!info) throw new Error(`Unknown extension ${id}`);
        return JSON.parse(JSON.stringify(info)) as ExtensionInfo;
    }
    packagePath(id: string): string {
        const path = this.locations.get(validateExtensionId(id));
        if (!path) throw new Error(`Unknown extension ${id}`);
        const info = Gio.File.new_for_path(path).query_info('standard::is-symlink,standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        const target = info.get_is_symlink() ? info.get_symlink_target() : null;
        return target ? GLib.canonicalize_filename(target, Gio.File.new_for_path(path).get_parent()!.get_path()!) : path;
    }
    update(id: string, enabled: boolean, values: SettingsValues): void {
        const info = this.get(id);
        if (info.error) throw new Error(`Cannot overwrite invalid settings: ${info.error}`);
        const state = validateState(info.manifest, {version: info.manifest.settingsVersion, enabled, values});
        writeJson(this.file(id), state);
        this.extensions.set(id, {...info, state}); this.changed();
    }
    settingsFile(id: string): string {
        const info = this.get(id), path = this.file(id);
        // Existing files, including invalid JSON, must remain available for repair.
        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) writeJson(path, info.state);
        return path;
    }
    async ensureSettingsFile(id: string): Promise<string> {return this.settingsFile(id);}
    reloadSettingsFile(path: string): void {
        const info = [...this.extensions.values()].find(info => this.file(info.manifest.id) === path);
        if (!info) return;
        const state = validateState(info.manifest, readJson(path));
        this.extensions.set(info.manifest.id, {...info, state, error: undefined}); this.changed();
    }
    subscribe(listener: () => void): () => void { return this.listeners.subscribe(listener); }
    /** Each process observes preferences/core config written by the Settings process. */
    watch(coreChanged: () => void = () => {}): () => void {
        const paths = [this.paths.preferences, GLib.path_get_dirname(this.paths.preferences)];
        const monitors: Gio.FileMonitor[] = [];
        let source = 0, stopped = false;
        const changed = () => {
            if (source || stopped) return;
            source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                source = 0;
                if (!stopped) {this.reload(); coreChanged();}
                return GLib.SOURCE_REMOVE;
            });
        };
        for (const path of paths) {
            GLib.mkdir_with_parents(path, 0o700);
            const monitor = Gio.File.new_for_path(path).monitor_directory(Gio.FileMonitorFlags.NONE, null);
            monitor.connect('changed', changed); monitors.push(monitor);
        }
        return () => {if (stopped) return; stopped = true; if (source) {GLib.source_remove(source); source = 0;} for (const monitor of monitors) monitor.cancel();};
    }
    private changed(): void {
        this.listeners.emit(reason => { this.diagnostics.push(`Subscriber: ${reason instanceof Error ? reason.message : String(reason)}`); });
    }
    dispose(): void { this.listeners.clear(); }
}
