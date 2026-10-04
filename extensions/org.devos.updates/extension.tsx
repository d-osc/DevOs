import {React} from '@dev-os/react-gtk';
import {Updates} from '../../src/updates/service.js';
import type {UIExtension} from '../../src/extensions/runtime.js';
import {UpdatesView} from './view.js';

export default {id: 'org.devos.updates', activate(context) {
    const updater = new Updates({repository: () => String(context.preferences.get('org.devos.updates').state.values.repository)});
    context.registerSettingsPage?.('org.devos.updates', () => <UpdatesView updater={updater} preferences={context.preferences} />);
    return () => updater.dispose();
}} satisfies UIExtension;
