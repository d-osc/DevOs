import {Gtk, Gdk, GLib} from '../../src/gtk.js';
import {configPath} from '../../src/config.js';
import {mountSettings} from './view.js';
import type {UIContext} from '../../src/extensions/runtime.js';

export class Settings {
    window: Gtk.ApplicationWindow;
    private view: ReturnType<typeof mountSettings>;
    constructor(context: UIContext) {
        this.window = new Gtk.ApplicationWindow({application: context.application, title: 'Dev OS Settings', default_width: 960, default_height: 640});
        this.window.name = 'settings';
        this.view = mountSettings(this.window, {
            extensions: context.preferences,
            pages: context.settingsPages,
            getCore: () => context.config(),
            saveCore: data => context.saveCore(data),
            applied: () => { if (!context.reload()) throw new Error('Could not reload preferences'); },
            openSettingsFile: context.openEditor ? id => {
                let path: string | undefined;
                if (id === 'core') {
                    path = configPath();
                    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) context.saveCore(context.config());
                } else path = context.preferences.settingsFile?.(id);
                if (!path || !context.openEditor!(path)) throw new Error('Editor is unavailable');
            } : undefined,
        });
        this.window.connect('delete-event', () => { this.window.hide(); return true; });
        this.window.connect('key-press-event', (_window, event) => {
            if ((event as unknown as Gdk.Event).get_keyval()[1] !== Gdk.KEY_Escape) return false;
            this.window.hide(); return true;
        });
    }
    show() { this.view.show(); }
    destroy() { this.view.destroy(); this.window.destroy(); }
}
