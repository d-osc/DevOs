import {React, type UIExtension} from '@dev-os/core';
import {CameraSettings} from './settings-view.js';
export default {id: 'org.devos.camera', activate(context) {
    const windows = new Set<{destroy(): void}>();
    context.registerSettingsPage?.('org.devos.camera', () => React.createElement(CameraSettings, {open: () => context.invoke('camera')}));
    context.registerCommand('camera', () => {context.invoke('launcher.hide'); void import('./window.js').then(({MediaWindow}) => {
        const window = new MediaWindow(context, 'camera', () => windows.delete(window)); windows.add(window);
    }).catch(error => printerr(`Camera could not open: ${String(error)}`));});
    return () => {for (const window of windows) window.destroy();};
}} satisfies UIExtension;
