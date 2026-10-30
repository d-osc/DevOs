import {Gio, GLib} from '@dev-os/core/base';
import {shellApplicationId} from './remote.js';

export const BASE_APPS = ['settings', 'files', 'terminal', 'editor', 'camera', 'microphone', 'taskmanager', 'browser', 'diskmanager', 'appstore', 'installer', 'screenshot'] as const;
export type BaseApp = typeof BASE_APPS[number];
export type ProcessRole = BaseApp | 'services';
const commands: Record<string, BaseApp> = {
    settings: 'settings', 'session.switch-user': 'settings', files: 'files', terminal: 'terminal', 'terminal.native': 'terminal', editor: 'editor',
    camera: 'camera', microphone: 'microphone', 'task-manager': 'taskmanager', browser: 'browser', 'disk-manager': 'diskmanager',
    'app-store': 'appstore', 'app-store-extensions': 'appstore', 'extension-store': 'appstore', 'settings.store': 'appstore', 'package-install': 'appstore', installer: 'installer', screenshot: 'screenshot', 'screenshot-app': 'screenshot',
};
export function appForCommand(command: string): BaseApp | undefined {return commands[command] ?? (command.startsWith('settings.') ? 'settings' : undefined);}
export function appExtension(app: BaseApp): string {return `org.devos.${app}`;}
export function processApplicationId(role: ProcessRole): string {return shellApplicationId().replace('org.devos.Shell.', `org.devos.${role === 'services' ? 'Services' : `App.${role}`}.`);}
export const SHELL_EXTENSIONS = new Set(['theme', 'icons', 'launcher', 'panel', 'background', 'displaycare'].map(name => `org.devos.${name}`));
export const APP_FOUNDATIONS = new Set(['org.devos.theme', 'org.devos.icons']);

/** Async IPC: a slow app must never make the shell wait on a synchronous D-Bus call. */
export function sendCommand(id: string, args: string[], cwd = GLib.get_current_dir()): Promise<void> {
    return new Promise((resolve, reject) => Gio.DBus.session.call(id, `/${id.replaceAll('.', '/')}/control`,
        'org.devos.Shell.Control', 'Execute', new GLib.Variant('(ass)', [args, cwd]),
        new GLib.VariantType('(is)'), Gio.DBusCallFlags.NO_AUTO_START, 10000, null, (connection, result) => {
            try {
                const [status, error] = connection!.call_finish(result).deep_unpack() as [number, string];
                if (status !== 0) throw new Error(error || `Command ${args[0]} failed`);
                resolve();
            } catch (error) {reject(error);}
        }));
}
export function missingProcess(error: unknown): boolean {
    return error instanceof GLib.Error && [Gio.DBusError.SERVICE_UNKNOWN, Gio.DBusError.NAME_HAS_NO_OWNER,
        Gio.DBusError.UNKNOWN_OBJECT, Gio.DBusError.UNKNOWN_INTERFACE].some(code => error.matches(Gio.DBusError, code));
}
