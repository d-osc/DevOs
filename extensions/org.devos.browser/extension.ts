import {type UIExtension} from '@dev-os/core';
import type {BrowserWindow} from './window.js';

export default {id: 'org.devos.browser', activate(context) {
    const windows = new Set<BrowserWindow>();
    let disposed = false;
    context.registerCommand('browser', () => {
        context.invoke('launcher.hide');
        void import('./window.js').then(({BrowserWindow}) => {
            if (disposed) return;
            const browser = new BrowserWindow(context, () => windows.delete(browser)); windows.add(browser);
        }).catch(error => printerr(`Browser requires WebKit2 4.1: ${String(error)}`));
    });
    return () => {disposed = true; for (const browser of windows) browser.window.destroy();};
}} satisfies UIExtension;
