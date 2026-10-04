// Keep the compositor and managed services tied to the GJS shell's lifetime.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {addUnixSignal} from './signals.js';
import System from 'system';
import {loadConfig, expandHome} from './config.js';

const loop = new GLib.MainLoop(null, false);
interface ManagedChild {process: Gio.Subprocess; pid: string | null; done: boolean;}
const children: ManagedChild[] = [];
let closing = false;
let resultCode = 0;
let deadline = 0;

function signalGroup(child: ManagedChild, signal: 'TERM' | 'KILL') {
    try {
        const kill = Gio.Subprocess.new(['kill', `-${signal}`, '--', `-${child.pid}`],
            Gio.SubprocessFlags.STDERR_SILENCE);
        kill.wait(null);
    } catch (error) { printerr(`Dev OS supervisor: ${(error instanceof Error ? error.message : String(error))}`); }
}

function finishIfReady() {
    if (!closing || children.some(child => !child.done)) return;
    if (deadline) { GLib.source_remove(deadline); deadline = 0; }
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
                shutdown();
            }
        } catch (error) { printerr((error instanceof Error ? error.message : String(error))); child.done = true; resultCode = 1; shutdown(); }
        finishIfReady();
    });
}

for (const signal of [15, 2]) addUnixSignal(GLib.PRIORITY_DEFAULT, signal, () => {
    shutdown(); return GLib.SOURCE_CONTINUE;
});
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
if (children.some(child => !child.done)) loop.run();
System.exit(resultCode);
