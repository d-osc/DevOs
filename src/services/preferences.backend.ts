import {ExtensionManager} from '@dev-os/extensions/manager';
import {loadConfig, saveConfig} from '@dev-os/config';
export class PreferencesData extends ExtensionManager {
    private stopWatching = this.watch();
    get snapshot() {
        const entries = this.list();
        const uiManifests = entries.filter(info => info.origin === 'bundled' && info.manifest.kind === 'ui' && info.manifest.system).map(info => info.manifest).sort((a, b) => a.order! - b.order! || a.id.localeCompare(b.id));
        return {entries, uiManifests, diagnostics: this.diagnostics, config: loadConfig(),
            locations: Object.fromEntries(this.list().map(info => {
                try {return [info.manifest.id, this.packagePath(info.manifest.id)];} catch {return [info.manifest.id, ''];}
            }))};
    }
    async initialize() {return this.snapshot;}
    async saveCore(config: unknown) {saveConfig(config); this.reload();}
    override dispose() {this.stopWatching(); super.dispose();}
}
