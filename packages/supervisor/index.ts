import {
    readJson, Gio, GLib
} from '@dev-os/core';
// Keep the compositor and managed services tied to the GJS shell's lifetime.
import {addUnixSignal} from '@dev-os/services/signals';

import {loadConfig, expandHome} from '@dev-os/config';
import {installedSessionRoot} from '@dev-os/runtime/session-version';

export function runSupervisor(): number {
    const loop = new GLib.MainLoop(null, false);
    interface ManagedChild {process: Gio.Subprocess; pid: string | null; done: boolean;}
    const children: ManagedChild[] = [];
    let closing = false;
    let resultCode = 0;
    let deadline = 0;
    let restartRoot = '';
    let finished = false;
    const requestPath = `${GLib.get_user_runtime_dir()}/dev-os-version-${GLib.uuid_string_random()}.json`;
    const previousRequest = GLib.getenv('DEV_OS_VERSION_REQUEST');
    GLib.setenv('DEV_OS_VERSION_REQUEST', requestPath, true);

    function signalGroup(child: ManagedChild, signal: 'TERM' | 'KILL') {
        try {
            const kill = Gio.Subprocess.new(['kill', `-${signal}`, '--', `-${child.pid}`],
                Gio.SubprocessFlags.STDERR_SILENCE);
            kill.wait(null);
        } catch (error) { printerr(`Dev OS supervisor: ${(error instanceof Error ? error.message : String(error))}`); }
    }

    function finishIfReady() {
        if (finished || !closing || children.some(child => !child.done)) return;
        finished = true;
        if (deadline) { GLib.source_remove(deadline); deadline = 0; }
        try { if (GLib.file_test(requestPath, GLib.FileTest.EXISTS)) Gio.File.new_for_path(requestPath).delete(null); } catch (error) { printerr(String(error)); }
        if (restartRoot) {
            try {
                const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
                const oldRoot = GLib.getenv('DEV_OS_ROOT');
                const path = (GLib.getenv('PATH') ?? '/usr/bin:/bin').split(':').filter(path => path !== `${oldRoot}/bin`).join(':');
                const data = (GLib.getenv('XDG_DATA_DIRS') ?? '/usr/local/share:/usr/share').split(':').filter(path => path !== `${oldRoot}/data`).join(':');
                launcher.setenv('PATH', `${restartRoot}/bin:${path}`, true);
                launcher.setenv('XDG_DATA_DIRS', `${restartRoot}/data:${data}`, true);
                launcher.setenv('DEV_OS_ROOT', restartRoot, true);
                launcher.setenv('DEV_OS_SHELL', `${restartRoot}/bin/dev-os-shell`, true);
                launcher.spawnv(['setsid', `${restartRoot}/bin/dev-os-start`]);
                print(`Dev OS: switching session runtime to ${restartRoot}`);
                loop.quit(); return;
            } catch (error) { resultCode = 1; printerr(`Dev OS version switch failed: ${String(error)}`); }
        }
        const pid = GLib.getenv('LABWC_PID') ?? '';
        if (/^[1-9][0-9]*$/.test(pid)) {
            try { Gio.Subprocess.new(['kill', '-TERM', pid], Gio.SubprocessFlags.STDERR_SILENCE).wait(null); }
            catch (error) { printerr(`Dev OS supervisor: ${(error instanceof Error ? error.message : String(error))}`); }
        }
        loop.quit();
    }

    function shutdown() {
        if (closing) return;
        closing = true;
        // Stop entire service groups, including children spawned by service scripts.
        for (const child of children) signalGroup(child, 'TERM');
        deadline = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            deadline = 0;
            for (const child of children) if (!child.done) signalGroup(child, 'KILL');
            finishIfReady();
            return GLib.SOURCE_REMOVE;
        });
        finishIfReady();
    }

    function spawn(command: readonly string[], isShell = false) {
        const process = Gio.Subprocess.new(['setsid', ...command.map(expandHome)], Gio.SubprocessFlags.NONE);
        const child = {process, pid: process.get_identifier(), done: false};
        children.push(child);
        process.wait_async(null, (_source, result) => {
            try {
                process.wait_finish(result); child.done = true;
                if (isShell) {
                    resultCode = process.get_if_exited() ? process.get_exit_status() : 1;
                    if (!closing && GLib.file_test(requestPath, GLib.FileTest.EXISTS)) {
                        try {
                            const request = readJson(requestPath) as {root: string};
                            if (request.root !== installedSessionRoot()) throw new Error('Requested runtime is no longer the installed selection');
                            restartRoot = request.root;
                        } catch (error) { printerr(`Dev OS version request rejected: ${String(error)}`); }
                    }
                    shutdown();
                }
            } catch (error) { printerr((error instanceof Error ? error.message : String(error))); child.done = true; resultCode = 1; shutdown(); }
            finishIfReady();
        });
    }

    const signalSources = [15, 2].map(signal => addUnixSignal(GLib.PRIORITY_DEFAULT, signal, () => {
        shutdown(); return GLib.SOURCE_CONTINUE;
    }));
    try {
        const config = loadConfig();
        const shell = GLib.getenv('DEV_OS_SHELL');
        if (!shell) throw new Error('DEV_OS_SHELL is missing');
        spawn([shell], true);
        for (const command of config.autostart) {
            if (GLib.find_program_in_path(expandHome(command[0]))) spawn(command);
            else printerr(`Dev OS: skipping missing autostart command ${command[0]}`);
        }
    } catch (error) { printerr(`Dev OS session: ${(error instanceof Error ? error.message : String(error))}`); resultCode = 1; shutdown(); }
    try {
        if (children.some(child => !child.done)) loop.run();
        return resultCode;
    } finally {
        for (const source of signalSources) GLib.source_remove(source);
        if (previousRequest === null) GLib.unsetenv('DEV_OS_VERSION_REQUEST');
        else GLib.setenv('DEV_OS_VERSION_REQUEST', previousRequest, true);
    }

}
