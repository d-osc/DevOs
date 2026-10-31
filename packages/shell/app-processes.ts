import {Gio, GLib, activeTheme, activeFamily} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {shellApplicationId} from '@dev-os/runtime/remote';
import {processApplicationId, sendCommand, missingProcess, optInNative, type ProcessRole} from '@dev-os/runtime/processes';

/** Apps with a native GTK executable under dist/native; every other role runs through the JS app host. */
const NATIVE_APPS: Partial<Record<ProcessRole, string>> = {taskmanager: 'taskmanager', diskmanager: 'diskmanager', installer: 'installer', files: 'files', terminal: 'terminal', settings: 'settings', camera: 'camera', microphone: 'microphone'};

/**
 * Apps whose native window can be tried before it becomes the default: DEVOS_NATIVE_<APP>=1, or a file at ~/.config/devos/native-<app>.
 * The JS app stays the default until the native one has been checked on a real session; without dist/native/<app> the JS app is used as well.
 */
const OPT_IN_APPS: readonly ProcessRole[] = ['browser', 'appstore', 'editor'];
export const nativeEnabled = (app: ProcessRole): boolean => optInNative(app);
export const nativeSettingsEnabled = () => nativeEnabled('settings');

/** D-Bus owns singleton identity; app processes survive a shell crash and reconnect on its restart. */
export class AppProcesses {
    private stopped = false;
    constructor(private report: (message: string) => void) {}
    launch(role: ProcessRole, command: string, path?: string) {
        if (this.stopped) return;
        const args = [command, ...(path === undefined ? [] : [path])];
        const background = command === 'settings.background';
        const panel = command === 'settings.panel';
        const identity = background ? processApplicationId('settings').replace('.settings.', '.backgroundsettings.') : panel ? processApplicationId('settings').replace('.settings.', '.panelsettings.') : processApplicationId(role);
        void sendCommand(identity, args).catch(error => {
            if (this.stopped) return;
            if (!missingProcess(error)) {this.report(`${command}: ${String(error)}`); return;}
            try {
                const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
                launcher.setenv('DEV_OS_ROOT', ROOT, true);
                const optIn = !background && !panel && OPT_IN_APPS.includes(role) && nativeEnabled(role) && GLib.file_test(`${ROOT}/dist/native/${role}`, GLib.FileTest.IS_EXECUTABLE);
                const executable = background ? 'background-settings' : panel ? 'panel-settings' : optIn ? role : NATIVE_APPS[role];
                const native = executable ? `${ROOT}/dist/native/${executable}` : undefined;
                if (native) {
                    if (!GLib.file_test(native, GLib.FileTest.IS_EXECUTABLE)) throw new Error(`Native ${executable} is missing. Run sh tools/build/native-apps.sh.`);
                    launcher.setenv('DEV_OS_NATIVE_ID', identity, true);
                    if (background) launcher.setenv('DEVOS_BACKGROUND_ROLE', 'settings', true);
                    if (panel) launcher.setenv('DEVOS_PANEL_ROLE', 'settings', true);
                    launcher.setenv('DEV_OS_SHELL_ID', shellApplicationId(), true);
                    launcher.setenv('DEV_OS_THEME', activeTheme(), true);
                    launcher.setenv('DEV_OS_THEME_FAMILY', activeFamily(), true);
                }
                const entry = role === 'services' ? 'services-host' : 'app-host';
                const process = launcher.spawnv(native ? [native, ...args] : ['gjs', '-m', `${ROOT}/dist/${entry}.js`, ...(role === 'services' ? [] : [role]), ...args]);
                process.wait_async(null, (_source, result) => {
                    try {process.wait_finish(result); if (!process.get_successful() && !this.stopped) this.report(`${command} process exited unsuccessfully`);}
                    catch (reason) {if (!this.stopped) this.report(`${command}: ${String(reason)}`);}
                });
            } catch (reason) {this.report(`Could not open ${command}: ${String(reason)}`);}
        });
    }
    destroy() {this.stopped = true;}
}
