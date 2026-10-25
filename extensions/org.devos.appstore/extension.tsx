import {Gtk, Gdk, Gio, React, createRoot, mountWindowHeader, type UIExtension} from '@dev-os/core';
import {launchDesktopApp} from '@dev-os/services/apps';
import {AppStore} from './backend.js';
import {AppStoreView} from './view.js';
import {AppStoreSettings} from './settings.js';
import {PackageManagerCli, absolutePath} from './package-backend.js';
import {PackageInstallView} from './package-view.js';
import {isPackageFile} from './package-file.js';

/** Make a window accept package files dropped from Files; each recognised file opens the install page. */
function acceptPackageDrops(window: Gtk.Window, open: (path: string) => void) {
    window.drag_dest_set(Gtk.DestDefaults.ALL, [new Gtk.TargetEntry({target: 'text/uri-list', flags: 0, info: 0})], Gdk.DragAction.COPY);
    window.connect('drag-data-received', (_widget, _context, _x, _y, selection) => {
        for (const uri of selection.get_uris() ?? []) { const path = Gio.File.new_for_uri(uri).get_path(); if (path && isPackageFile(path)) open(path); }
    });
}
function launchCommand(command: string): string | null {
    const app = Gio.AppInfo.get_all().find(item => item.get_id() === `dev-${command}.desktop`);
    if (!app) return 'The launcher entry was not found. This package has no launcher; run it with: dev run ' + command;
    void launchDesktopApp(app).catch(reason => printerr(`Package launch failed: ${String(reason)}`));
    return null;
}

export default {id: 'org.devos.appstore', activate(context) {
    let window: Gtk.ApplicationWindow | undefined, installer: Gtk.ApplicationWindow | undefined, renderInstaller = () => {};
    const queue: string[] = [], packages = new PackageManagerCli();
    const openPackage = (path: string) => {
        if (!isPackageFile(path)) throw new Error('Package install supports .dpk, .deb, .rpm and .tar.gz files.');
        const local = absolutePath(path); if (!queue.includes(local)) queue.push(local);
        if (installer) { renderInstaller(); installer.present(); return; }
        context.invoke('launcher.hide');
        const win = installer = new Gtk.ApplicationWindow({application: context.application, title: 'Install Package', default_width: 640, default_height: 700}); win.name = 'package-install';
        const root = createRoot(win), header = mountWindowHeader(win, {title: 'Install Package', iconName: 'dev-os-app-store-symbolic', windowIconName: 'dev-os-app-store'});
        renderInstaller = () => root.render(<PackageInstallView controls={packages} paths={[...queue]} launch={launchCommand} onClose={() => win.destroy()}/>);
        renderInstaller(); acceptPackageDrops(win, openPackage);
        win.connect('delete-event', () => packages.busy);
        win.connect('destroy', () => { root.unmount(); header.destroy(); installer = undefined; queue.length = 0; renderInstaller = () => {}; });
        win.show_all(); win.present();
    };
    context.registerSettingsPage?.('org.devos.appstore', () => <AppStoreSettings openStore={() => context.invoke('app-store')}/>);
    context.registerCommand('package-install', (_monitor, path) => { if (path) openPackage(path); else if (installer) installer.present(); });
    context.registerCommand('app-store', () => {
        context.invoke('launcher.hide'); if (window) {window.present(); return;}
        const controls = new AppStore();
        window = new Gtk.ApplicationWindow({application: context.application, title: 'App Store', default_width: 1100, default_height: 760}); window.name = 'app-store';
        const root = createRoot(window), header = mountWindowHeader(window, {title: 'App Store', iconName: 'dev-os-app-store-symbolic', windowIconName: 'dev-os-app-store'});
        root.render(<AppStoreView controls={controls} packages={packages} launchCommand={launchCommand}/>);
        acceptPackageDrops(window, openPackage);
        window.connect('delete-event', () => controls.busy || packages.busy);
        window.connect('destroy', () => {root.unmount(); header.destroy(); window = undefined;}); window.show_all(); window.present();
    }); return () => { window?.destroy(); installer?.destroy(); };
}} satisfies UIExtension;
