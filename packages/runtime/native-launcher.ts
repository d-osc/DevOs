import {Gio, GLib, activeTheme, activeFamily} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {shellApplicationId} from './remote.js';
import {optInNative, sendCommand, missingProcess} from './processes.js';

/**
 * The native Launcher window (dist/native/launcher, DevLang) behind an opt-in switch: DEVOS_NATIVE_LAUNCHER=1 or ~/.config/devos/native-launcher.
 * It is one window per session on the D-Bus name org.devos.App.launcher.<shell id>. Asking a running window for `launcher` closes it (a toggle),
 * so a missing process means "open"; without the executable the JS launcher stays in use.
 */
const executable = () => `${ROOT}/dist/native/launcher`;
export const nativeLauncherEnabled = () => optInNative('launcher') && GLib.file_test(executable(), GLib.FileTest.IS_EXECUTABLE);
const identity = () => shellApplicationId().replace('org.devos.Shell.', 'org.devos.App.launcher.');

function spawn(logout: boolean) {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('DEV_OS_ROOT', ROOT, true);
    launcher.setenv('DEV_OS_NATIVE_ID', identity(), true);
    launcher.setenv('DEV_OS_SHELL_ID', shellApplicationId(), true);
    launcher.setenv('DEV_OS_THEME', activeTheme(), true);
    launcher.setenv('DEV_OS_THEME_FAMILY', activeFamily(), true);
    if (logout) launcher.setenv('DEVOS_LAUNCHER_LOGOUT', '1', true);
    launcher.spawnv([executable()]);
}
/** `open`: a running window gets the command (toggle, or logout), a missing one is started. Closing commands never start a window. */
export function nativeLauncher(args: string[], open: boolean, report: (message: string) => void) {
    void sendCommand(identity(), args).catch(error => {
        if (!missingProcess(error)) {report(`${args.join(' ')}: ${String(error)}`); return;}
        if (!open) return;
        try {spawn(args[1] === 'logout');} catch (reason) {report(`Could not open the native launcher: ${String(reason)}`);}
    });
}
