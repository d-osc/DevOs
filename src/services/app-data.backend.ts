import {ExtensionManager} from '@dev-os/extensions/manager';
import {ExtensionStore} from '../../packages/extensions/store.js';
import {Updates} from '@dev-os/updates';

export {PreferencesData} from './preferences.backend.js';
export class UpdatesData extends Updates {
    private preferences: ExtensionManager;
    private unwatch: () => void;
    constructor() {
        const preferences = new ExtensionManager();
        super({repository: () => String(preferences.get('org.devos.updates').state.values.repository)});
        this.preferences = preferences; this.unwatch = preferences.watch();
    }
    override dispose() {this.unwatch(); this.preferences.dispose(); super.dispose();}
}
export class ExtensionStoreData extends ExtensionStore {
    private preferences: ExtensionManager;
    private unwatch: () => void;
    constructor() {
        const preferences = new ExtensionManager(); super(preferences);
        this.preferences = preferences; this.unwatch = preferences.watch();
    }
    get installable() {return this.items.filter(item => this.canInstall(item)).map(item => item.repository);}
    override dispose() {this.unwatch(); this.preferences.dispose(); super.dispose();}
}
