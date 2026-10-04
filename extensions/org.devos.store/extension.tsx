import {React} from '@dev-os/react-gtk';
import {ExtensionStore} from '../../src/extensions/store.js';
import {ExtensionManager} from '../../src/extensions/manager.js';
import type {UIExtension} from '../../src/extensions/runtime.js';
import {StoreView} from './view.js';

export default {id: 'org.devos.store', activate(context) {
    if (!(context.preferences instanceof ExtensionManager)) throw new Error('The Store requires the base ExtensionManager');
    const store = new ExtensionStore(context.preferences);
    context.registerSettingsPage?.('org.devos.store', () => <StoreView store={store} preferences={context.preferences} />);
    return () => store.dispose();
}} satisfies UIExtension;
