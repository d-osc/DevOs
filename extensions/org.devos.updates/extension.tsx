import {
    React, type UIExtension
} from '@dev-os/core';
import {Updates} from '@dev-os/updates';
import {UpdatesView} from './view.js';

export default {id: 'org.devos.updates', activate(context) {
    const updater = new Updates({repository: () => String(context.preferences.get('org.devos.updates').state.values.repository)});
    context.registerSettingsPage?.('org.devos.updates', () => <UpdatesView updater={updater} preferences={context.preferences} useVersion={context.useInstalledVersion} />);
    return () => updater.dispose();
}} satisfies UIExtension;
