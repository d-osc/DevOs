import {
    React, type UIExtension
} from '@dev-os/core';
import {monitorUI} from '@dev-os/extensions';
import {Panel} from './index.js';
import {PanelSettings} from './settings-view.js';

export default {id: 'org.devos.panel', activate(context) {
    context.registerSettingsPage?.('org.devos.panel', () => React.createElement(PanelSettings, {
        preferences: context.preferences, getConfig: () => context.config(),
        applied: () => { if (!context.reload()) throw new Error('Could not reload the panel.'); },
    }));
    const surfaces = monitorUI(context, monitor => new Panel(context, monitor));
    context.onMessage(message => surfaces.values().forEach(panel => panel.showMessage(message)));
    return surfaces.destroy;
}} satisfies UIExtension;
