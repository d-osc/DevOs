import {
    React, type UIExtension
} from '@dev-os/core';
import {monitorUI} from '@dev-os/extensions';
import {Background} from './index.js';
import {BackgroundSettings} from './settings-view.js';
import {BackgroundModel} from './native-model.js';

export default {id: 'org.devos.background', activate(context) {
    context.registerSettingsPage?.('org.devos.background', () => React.createElement(BackgroundSettings, {
        preferences: context.preferences, getConfig: () => context.config(), parent: context.application.get_active_window(),
        windows: context.windows,
        applied: () => { if (!context.reload()) throw new Error('Could not reload the background.'); },
    }));
    const model = new BackgroundModel(context);
    const windows = monitorUI(context, monitor => {model.refresh(); return new Background(context, monitor, context.config(), model);});
    return () => {windows.destroy(); model.destroy();};
}} satisfies UIExtension;
