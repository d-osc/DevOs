import {Gio, GLib} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
import {addUnixSignal} from '@dev-os/services/signals';
export interface SupervisorOptions {
    /** Tests/embedded hosts may explicitly disable the independent service host. */
    services?: boolean;
    /** Delay before a crashed shell is started again. */
    restartDelaySeconds?: number;
    /** Crashes tolerated inside `restartWindowSeconds` before the session is ended instead of restarted. */
    maxRestarts?: number;
    restartWindowSeconds?: number;
}

/** JS/TS binding to the same DevLang lifecycle implementation used by the session. */
export function runSupervisor(options: SupervisorOptions = {}): number {
    const loop = new GLib.MainLoop(null, false);
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('DEV_OS_ROOT', ROOT, true);
    let child: Gio.Subprocess;
    try {
        child = launcher.spawnv(['devrun', `${ROOT}/src/system/supervisor.dev`, '--ffi-lib',
            `${ROOT}/dist/native/libsupervisor.so`, '--', '--options', JSON.stringify(options)]);
    } catch (error) {printerr(`Dev OS supervisor: ${String(error)}`); return 1;}
    let finished = false, code = 1;
    const signals = [15, 2].map(signal => addUnixSignal(GLib.PRIORITY_DEFAULT, signal, () => {
        if (!finished) try {child.send_signal(signal);} catch (error) {printerr(String(error));}
        return GLib.SOURCE_CONTINUE;
    }));
    child.wait_async(null, (_child, result) => {
        try {child.wait_finish(result); code = child.get_if_exited() ? child.get_exit_status() : 1;}
        catch (error) {printerr(String(error));}
        finished = true; loop.quit();
    });
    try {if (!finished) loop.run(); return code;}
    finally {signals.forEach(source => GLib.source_remove(source));}
}
