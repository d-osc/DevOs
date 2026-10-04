import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ROOT, readText} from '../config.js';
import {writeJson} from '../preferences.js';
import {validateExtensionId, validateManifest, validateState, validateValues} from './schema.js';
import type {ExtensionInfo, SettingsHost, SettingsValues} from './types.js';

export class ExtensionManager implements SettingsHost {
    private extensions = new Map<string, ExtensionInfo>();
    private listeners = new Set<() => void>();
    diagnostics: string[] = [];
    constructor(private paths = {
        bundled: `${ROOT}/extensions`,
        user: `${GLib.get_user_data_dir()}/dev-os/extensions`,
        preferences: `${GLib.get_user_config_dir()}/dev-os/extensions`,
    }) { this.reload(); }
    private file(id: string): string { return `${this.paths.preferences}/${validateExtensionId(id)}.json`; }
    reload(): void {
        const next = new Map<string, ExtensionInfo>();
        this.diagnostics = [];
        for (const origin of ['bundled', 'user'] as const) {
            const directory = Gio.File.new_for_path(this.paths[origin]);
            if (!directory.query_exists(null)) continue;
            let enumerator: Gio.FileEnumerator;
            try { enumerator = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null); }
            catch (reason) { this.diagnostics.push(`${origin}: ${reason instanceof Error ? reason.message : String(reason)}`); continue; }
            try {
                for (let entry = enumerator.next_file(null); entry; entry = enumerator.next_file(null)) {
                    if (entry.get_file_type() !== Gio.FileType.DIRECTORY) continue;
                    // Every package contributes metadata through its JSON manifest.
                    if (!GLib.file_test(`${this.paths[origin]}/${entry.get_name()}/extension.json`, GLib.FileTest.EXISTS)) continue;
                    try {
                        const manifest = validateManifest(JSON.parse(readText(`${this.paths[origin]}/${entry.get_name()}/extension.json`)));
                        if (origin === 'user' && (manifest.system || next.get(manifest.id)?.manifest.system))
                            throw new Error('User packages cannot declare or replace system UI');
                        let state = {version: manifest.settingsVersion, enabled: manifest.enabledByDefault, values: validateValues(manifest, {})};
                        let error: string | undefined;
                        if (GLib.file_test(this.file(manifest.id), GLib.FileTest.EXISTS)) {
                            try { state = validateState(manifest, JSON.parse(readText(this.file(manifest.id)))); }
                            catch (reason) { error = reason instanceof Error ? reason.message : String(reason); state.enabled = manifest.system === true; }
                        }
                        next.set(manifest.id, {manifest, origin, state, error});
                        if (error) this.diagnostics.push(`${manifest.id}: ${error}`);
                    } catch (reason) { this.diagnostics.push(`${entry.get_name()}: ${reason instanceof Error ? reason.message : String(reason)}`); }
                }
            } catch (reason) { this.diagnostics.push(`${origin}: ${reason instanceof Error ? reason.message : String(reason)}`); }
            finally { enumerator.close(null); }
        }
        this.extensions = next; this.changed();
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
    update(id: string, enabled: boolean, values: SettingsValues): void {
        const info = this.get(id);
        if (info.error) throw new Error(`Cannot overwrite invalid settings: ${info.error}`);
        const state = validateState(info.manifest, {version: info.manifest.settingsVersion, enabled, values});
        writeJson(this.file(id), state);
        this.extensions.set(id, {...info, state}); this.changed();
    }
    subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    private changed(): void {
        for (const listener of this.listeners) {
            try { listener(); }
            catch (reason) { this.diagnostics.push(`Subscriber: ${reason instanceof Error ? reason.message : String(reason)}`); }
        }
    }
    dispose(): void { this.listeners.clear(); }
}
