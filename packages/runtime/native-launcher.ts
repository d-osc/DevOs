import {Gio, GLib, activeTheme, activeFamily} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {shellApplicationId} from './remote.js';
import {optInNative, sendCommand, missingProcess} from './processes.js';

/**
 * The native Launcher and Task View windows (dist/native/launcher and dist/native/task-view, DevLang) behind opt-in switches: DEVOS_NATIVE_LAUNCHER=1 or
 * ~/.config/devos/native-launcher, and the same with `task-view`. Each is one window per session on the D-Bus name org.devos.App.<name>.<shell id>.
 * Asking a running window for its own command closes it (a toggle), so a missing process means "open"; without the executable the JS code stays in use.
 */
class NativeOverlay {
    constructor(private name: 'launcher' | 'task-view') {}
    private executable() { return `${ROOT}/dist/native/${this.name}`; }
    private identity() { return shellApplicationId().replace('org.devos.Shell.', `org.devos.App.${this.name}.`); }
    enabled() { return optInNative(this.name) && GLib.file_test(this.executable(), GLib.FileTest.IS_EXECUTABLE); }
    private spawn(logout: boolean) {
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        launcher.setenv('DEV_OS_ROOT', ROOT, true);
        launcher.setenv('DEV_OS_NATIVE_ID', this.identity(), true);
        launcher.setenv('DEV_OS_SHELL_ID', shellApplicationId(), true);
        launcher.setenv('DEV_OS_THEME', activeTheme(), true);
        launcher.setenv('DEV_OS_THEME_FAMILY', activeFamily(), true);
        if (logout) launcher.setenv('DEVOS_LAUNCHER_LOGOUT', '1', true);
        launcher.spawnv([this.executable()]);
    }
    /** `open`: a running window gets the command (toggle, or logout), a missing one is started. Closing commands never start a window. */
    send(args: string[], open: boolean, report: (message: string) => void) {
        void sendCommand(this.identity(), args).catch(error => {
            if (!missingProcess(error)) {report(`${args.join(' ')}: ${String(error)}`); return;}
            if (!open) return;
            try {this.spawn(args[1] === 'logout');} catch (reason) {report(`Could not open the native ${this.name}: ${String(reason)}`);}
        });
    }
}
const launcher = new NativeOverlay('launcher'), taskView = new NativeOverlay('task-view');
export const nativeLauncherEnabled = () => launcher.enabled();
export const nativeLauncher = (args: string[], open: boolean, report: (message: string) => void) => launcher.send(args, open, report);
export const nativeTaskViewEnabled = () => taskView.enabled();
export const nativeTaskView = (args: string[], open: boolean, report: (message: string) => void) => taskView.send(args, open, report);
