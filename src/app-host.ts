import {GLib} from '@dev-os/core/base';
import System from 'system';
import {AppPreferences} from './app-data.js';
import {closeAppService} from '@dev-os/runtime/app-service';
import {ROOT, loadConfig} from '@dev-os/config';
import {BASE_APPS, APP_FOUNDATIONS, appExtension, type BaseApp} from '@dev-os/runtime/processes';

try {
    const [role, ...args] = ARGV;
    if (!(BASE_APPS as readonly string[]).includes(role)) throw new Error('Unknown base app process');
    GLib.setenv('GDK_BACKEND', 'wayland', true);
    const app = role as BaseApp;
    GLib.setenv('DEV_OS_APP', app, true);
    const {loadSystemExtensions} = await import('@dev-os/extensions');
    const {DesktopShell} = await import('@dev-os/shell');
    const initializeSettings = app === 'settings' ? (await import('./app-settings.js')).registerAppSettings : undefined;
    const preferences = new AppPreferences();
    const config = await preferences.initialize();
    const definitions = await loadSystemExtensions(ROOT, id => APP_FOUNDATIONS.has(id) || id === appExtension(app), preferences.uiManifests());
    const host = new DesktopShell({app, config, appConfig: {get: () => preferences.getCore(), save: value => preferences.saveCore(value)}, uiDefinitions: definitions, preferences, initializeSettings});
    const status = await host.runAsync(['dev-os-app', ...args]);
    closeAppService();
    System.exit(status);
} catch (error) {printerr(`Dev OS base app: ${String(error)}`); System.exit(1);}
