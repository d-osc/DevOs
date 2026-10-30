import {React, type UIContext} from '@dev-os/core';
import {ExtensionManager} from '@dev-os/extensions';
import {AppUpdates as Updates} from './app-data.js';
import {sendCommand, processApplicationId, missingProcess} from '@dev-os/runtime/processes';
import {UpdatesView} from './apps/org.devos.updates/view.js';
import {TerminalSettings} from './apps/org.devos.terminal/settings-view.js';
import {CameraSettings} from './apps/org.devos.camera/settings-view.js';
import {MicrophoneSettings} from './apps/org.devos.microphone/settings-view.js';
import {TaskManagerSettings} from './apps/org.devos.taskmanager/settings.js';
import {DiskManagerSettings} from './apps/org.devos.diskmanager/settings.js';
import {AppStoreSettings} from './apps/org.devos.appstore/settings.js';

/** Settings pages are views, not app activations: opening Settings never starts other apps or desktop surfaces. */
export function registerAppSettings(context: UIContext): () => void {
    const preferences = context.preferences as ExtensionManager, applied = () => {context.reload();};
    const openExtensions = () => {void sendCommand(processApplicationId('appstore'), ['app-store-extensions']).catch(error => {
        if (missingProcess(error)) context.invoke('app-store-extensions'); else printerr(`Could not open Extensions: ${String(error)}`);
    });};
    const updater = new Updates();
    const pages = {
        terminal: () => <TerminalSettings preferences={preferences}/>,
        camera: () => <CameraSettings open={() => context.invoke('camera')}/>,
        microphone: () => <MicrophoneSettings open={() => context.invoke('microphone')}/>,
        taskmanager: () => <TaskManagerSettings openManager={() => context.invoke('task-manager')}/>,
        diskmanager: () => <DiskManagerSettings openManager={() => context.invoke('disk-manager')}/>,
        appstore: () => <AppStoreSettings openStore={() => context.invoke('app-store')} openExtensions={openExtensions}/>,
        updates: () => <UpdatesView updater={updater} preferences={preferences} useVersion={context.useInstalledVersion}/>,
    };
    const cleanups = Object.entries(pages).map(([id, page]) => context.registerSettingsPage!(`org.devos.${id}`, page));
    return () => {for (const cleanup of cleanups) cleanup(); updater.dispose();};
}
