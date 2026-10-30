import {
    React, type UIExtension
} from '@dev-os/core';
import {Files} from './index.js';
import {FilesSettings} from './settings-view.js';

export default {id: 'org.devos.files', activate(context) {
    context.registerSettingsPage?.('org.devos.files', () => React.createElement(FilesSettings, {preferences: context.preferences}));
    const windows = new Set<Files>();
    const closed = (files: Files) => windows.delete(files);
    const opened = (files: Files) => windows.add(files);
    context.registerCommand('files', () => {
        context.invoke('launcher.hide');
        const files = [...windows].at(-1);
        if (files) files.show(); else new Files(context, closed, {opened});
    });
    context.onReload(() => { for (const files of windows) files.update(); });
    const unsubscribe = context.preferences.subscribe(() => {for (const files of windows) files.update();});
    return () => { unsubscribe(); for (const files of [...windows]) files.destroy(); };
}} satisfies UIExtension;
