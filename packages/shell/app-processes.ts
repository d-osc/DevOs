import {Gio, GLib, activeTheme, activeFamily} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {shellApplicationId} from '@dev-os/runtime/remote';
import {processApplicationId, sendCommand, missingProcess, type ProcessRole} from '@dev-os/runtime/processes';

/** Apps with a native GTK executable under dist/native; every other role runs through the JS app host. */
const NATIVE_APPS: Partial<Record<ProcessRole, string>> = {taskmanager: 'taskmanager', diskmanager: 'diskmanager', installer: 'installer'};

/**
 * Opt in to the native Settings window: DEVOS_NATIVE_SETTINGS=1, or a file at ~/.config/devos/native-settings. The JS Settings stays the
 * default until the native one has been checked on a real session; without dist/native/settings the JS Settings is used as well.
 */
export function nativeSettingsEnabled(): boolean {
    if (GLib.getenv('DEVOS_NATIVE_SETTINGS') === '1') return true;
    return GLib.file_test(GLib.build_filenamev([GLib.get_user_config_dir(), 'devos', 'native-settings']), GLib.FileTest.EXISTS);
}

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
                const nativeSettings = role === 'settings' && !background && !panel && nativeSettingsEnabled() && GLib.file_test(`${ROOT}/dist/native/settings`, GLib.FileTest.IS_EXECUTABLE);
                const executable = background ? 'background-settings' : panel ? 'panel-settings' : nativeSettings ? 'settings' : NATIVE_APPS[role];
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
