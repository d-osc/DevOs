import {GLib, Listeners} from '@dev-os/core/base';
import {VERSION, validateConfig} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions/manager';
import {validateState} from '@dev-os/extensions/schema';
import type {ExtensionInfo, SettingsValues} from '@dev-os/extensions/types';
import {serviceClass} from '@dev-os/runtime/app-service';

const PreferencesData = serviceClass<typeof import('./services/app-data.backend.js').PreferencesData>('preferences', {snapshot: {entries: [], uiManifests: [], diagnostics: [], config: null, locations: {}}});

/** Preferences are read-only view snapshots here; validation/persistence live in the worker. */
export class AppPreferences extends ExtensionManager {
    private data?: InstanceType<typeof PreferencesData>;
    private views = new Listeners();
    private entries: ExtensionInfo[] = [];
    private viewLocations: Record<string, string> = {};
    private unsubscribe?: () => void;
    private coreConfig?: import('@dev-os/config').Config;
    constructor() {
        super();
        this.data = new PreferencesData();
        this.unsubscribe = this.data.subscribe(() => this.applySnapshot());
    }
    private applySnapshot() {
        if (!this.data) return;
        const snapshot = this.data.snapshot;
        this.entries = snapshot.entries; this.viewLocations = snapshot.locations;
        this.diagnostics = snapshot.diagnostics; this.coreConfig = snapshot.config;
        this.views.emit();
    }
    async initialize() {await this.data!.initialize(); this.applySnapshot(); return this.coreConfig!;}
    uiManifests() {return this.data?.snapshot.uiManifests ?? [];}
    getCore() {return this.coreConfig!;}
    saveCore(config: unknown) {this.coreConfig = validateConfig(config); return this.data!.saveCore(config).catch(error => {this.diagnostics.push(String(error)); this.reload(); throw error;});}
    override reload() {if (this.data) void Promise.resolve(this.data.reload()).catch(error => {this.diagnostics.push(String(error)); this.views.emit();});}
    override list() {return this.entries;}
    override get(id: string) {const info = this.entries.find(info => info.manifest.id === id); if (!info) throw new Error(`Unknown extension ${id}`); return info;}
    override packagePath(id: string) {const path = this.viewLocations[id]; if (!path) throw new Error(`Unknown extension ${id}`); return path;}
    override update(id: string, enabled: boolean, values: SettingsValues) {
        const info = this.get(id), state = validateState(info.manifest, {version: info.manifest.settingsVersion, enabled, values});
        // Reflect the user's input immediately; the service validates again and publishes the persisted result.
        this.entries = this.entries.map(item => item.manifest.id === id ? {...item, state} : item); this.views.emit();
        const pending = Promise.resolve(this.data!.update(id, enabled, values)).catch(error => {this.diagnostics.push(String(error)); this.reload(); throw error;});
        void pending.catch(() => {}); return pending;
    }
    override settingsFile(id: string) {
        this.get(id);
        void Promise.resolve(this.data!.settingsFile(id)).catch(error => {this.diagnostics.push(String(error));});
        return `${GLib.get_user_config_dir()}/dev-os/extensions/${id}.json`;
    }
    override async ensureSettingsFile(id: string) {return await this.data!.ensureSettingsFile(id);}
    override async reloadSettingsFile(path: string) {await this.data!.reloadSettingsFile(path); this.applySnapshot();}
    override subscribe(listener: () => void) {return this.views.subscribe(listener);}
    override watch(coreChanged: () => void = () => {}) {return this.views.subscribe(coreChanged);}
    override dispose() {this.unsubscribe?.(); this.data?.dispose(); this.views.clear();}
}

export const AppUpdates = serviceClass<new () => import('@dev-os/updates').Updates>('updates', {
    state: {status: 'idle', busy: false, error: '', message: 'Loading update service…', release: null,
        running: VERSION, installed: VERSION, managed: false, previous: null, checked: '',
        swaylock: {installed: null, latest: null, available: false, error: ''},
        system: {supported: false, reason: '', version: '', kernel: '', safeBoot: false, signed: false, offer: null, pending: '', canRollback: false, lastError: '', restart: false},
        progress: null, patch: null, trust: '', blocked: '', offline: false},
    canInstall: false, selectedRoot: null, canUseInstalled: false,
});
export const AppExtensionStore = serviceClass<new () => import('@dev-os/extensions').ExtensionStore>('extension-store', {
    items: [], busy: false, error: '', message: 'Loading extension service…', installable: [],
}, ['disconnect'], {canInstall: (snapshot, item) => snapshot.installable.includes(item.repository)});
