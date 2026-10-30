import {
    Gtk, Gdk, GLib, type UIContext
} from '@dev-os/core';
import {configPath} from '@dev-os/config';
import {mountSettings} from './view.js';
import {settingsOptions} from './options.js';
import {AppProcesses} from '../../../packages/shell/app-processes.js';

export class Settings {
    window: Gtk.ApplicationWindow;
    private view: ReturnType<typeof mountSettings>;
    constructor(context: UIContext, switchUser?: (username?: string) => void) {
        const native = new AppProcesses(message => printerr(message));
        this.window = new Gtk.ApplicationWindow({application: context.application, title: 'Dev OS Settings', default_width: 960, default_height: 640});
        this.window.name = 'settings';
        this.view = mountSettings(this.window, {
            extensions: context.preferences,
            pages: context.settingsPages,
            openFiles: () => context.invoke('files'),
            switchUser,
            openNativePage: id => {if (id === 'org.devos.background') {native.launch('settings', 'settings.background'); return true;} if (id === 'org.devos.panel') {native.launch('settings', 'settings.panel'); return true;} return false;},
            getCore: () => context.config(),
            saveCore: data => context.saveCore(data),
            applied: () => { if (!context.reload()) throw new Error('Could not reload preferences'); },
            openSettingsFile: context.openEditor ? async id => {
                let path: string | undefined;
                if (id === 'core') {
                    path = configPath();
                    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) await context.saveCore(context.config());
                } else path = await (context.preferences.ensureSettingsFile?.(id) ?? context.preferences.settingsFile?.(id));
                if (!path || !context.openEditor!(path)) throw new Error('Editor is unavailable');
            } : undefined,
        });
        this.window.connect('delete-event', () => { this.window.hide(); return true; });
        this.window.connect('key-press-event', (_window, event) => {
            if ((event as unknown as Gdk.Event).get_keyval()[1] !== Gdk.KEY_Escape) return false;
            if (!settingsOptions(context.preferences.get('org.devos.settings').state.values).closeOnEscape) return false;
            this.window.hide(); return true;
        });
    }
    show(page?: string) { this.view.show(page); }
    destroy() { this.view.destroy(); this.window.destroy(); }
}
