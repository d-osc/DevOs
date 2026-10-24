import {React, type UIExtension} from '@dev-os/core';
import {MicrophoneSettings} from './settings-view.js';
export default {id: 'org.devos.microphone', activate(context) {
    const windows = new Set<{destroy(): void}>();
    context.registerSettingsPage?.('org.devos.microphone', () => React.createElement(MicrophoneSettings, {open: () => context.invoke('microphone')}));
    context.registerCommand('microphone', () => {context.invoke('launcher.hide'); void import('../org.devos.camera/window.js').then(({MediaWindow}) => {
        const window = new MediaWindow(context, 'microphone', () => windows.delete(window)); windows.add(window);
    }).catch(error => printerr(`Microphone could not open: ${String(error)}`));});
    return () => {for (const window of windows) window.destroy();};
}} satisfies UIExtension;
