import {Gtk, React, createRoot, mountWindowHeader, type UIExtension} from '@dev-os/core';
import {AppStore} from './backend.js';
import {AppStoreView} from './view.js';
import {AppStoreSettings} from './settings.js';
export default {id: 'org.devos.appstore', activate(context) {
    let window: Gtk.ApplicationWindow | undefined;
    context.registerSettingsPage?.('org.devos.appstore', () => <AppStoreSettings openStore={() => context.invoke('app-store')}/>);
    context.registerCommand('app-store', () => {
        context.invoke('launcher.hide'); if (window) {window.present(); return;}
        const controls = new AppStore();
        window = new Gtk.ApplicationWindow({application: context.application, title: 'App Store', default_width: 1100, default_height: 760}); window.name = 'app-store';
        const root = createRoot(window), header = mountWindowHeader(window, {title: 'App Store', iconName: 'system-software-install-symbolic'});
        root.render(<AppStoreView controls={controls}/>);
        window.connect('delete-event', () => controls.busy);
        window.connect('destroy', () => {root.unmount(); header.destroy(); window = undefined;}); window.show_all(); window.present();
    }); return () => window?.destroy();
}} satisfies UIExtension;
