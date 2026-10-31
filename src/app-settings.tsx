import {React, type UIContext} from '@dev-os/core';
import {ExtensionManager} from '@dev-os/extensions';
import {AppUpdates as Updates} from './app-data.js';
import {sendCommand, processApplicationId, missingProcess} from '@dev-os/runtime/processes';
import {AppStoreSettings} from './apps/org.devos.appstore/settings.js';

/** Settings pages are views, not app activations: opening Settings never starts other apps or desktop surfaces. */
export function registerAppSettings(context: UIContext): () => void {
    const preferences = context.preferences as ExtensionManager, applied = () => {context.reload();};
    const openExtensions = () => {void sendCommand(processApplicationId('appstore'), ['app-store-extensions']).catch(error => {
        if (missingProcess(error)) context.invoke('app-store-extensions'); else printerr(`Could not open Extensions: ${String(error)}`);
    });};
    const updater = new Updates();
    const pages = {
        appstore: () => <AppStoreSettings openStore={() => context.invoke('app-store')} openExtensions={openExtensions}/>,
    };
    const cleanups = Object.entries(pages).map(([id, page]) => context.registerSettingsPage!(`org.devos.${id}`, page));
    return () => {for (const cleanup of cleanups) cleanup(); updater.dispose();};
}
