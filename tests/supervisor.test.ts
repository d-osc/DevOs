import {Gio, GLib} from '@dev-os/core';
const originalRequest = GLib.getenv('DEV_OS_VERSION_REQUEST');
const {runSupervisor} = await import('@dev-os/supervisor');
const {DesktopShell} = await import('@dev-os/shell');
if (GLib.getenv('DEV_OS_VERSION_REQUEST') !== originalRequest)
    throw new Error('Importing supervisor started a supervisor');
if (typeof DesktopShell !== 'function') throw new Error('Missing shell export');
const directory = GLib.dir_make_tmp('dev-os-supervisor-XXXXXX');
const keys = ['XDG_CONFIG_HOME', 'DEV_OS_SHELL', 'LABWC_PID', 'DEV_OS_VERSION_REQUEST'];
const previous = keys.map(key => GLib.getenv(key));
try {
    GLib.setenv('XDG_CONFIG_HOME', directory, true);
    GLib.setenv('DEV_OS_SHELL', '/usr/bin/true', true);
    GLib.unsetenv('LABWC_PID');
    GLib.setenv('DEV_OS_VERSION_REQUEST', 'previous-request', true);
    for (let attempt = 0; attempt < 2; attempt++) {
        if (runSupervisor() !== 0) throw new Error('Supervisor did not return child exit code');
        if (GLib.getenv('DEV_OS_VERSION_REQUEST') !== 'previous-request')
            throw new Error('Supervisor did not restore the host environment');
    }
    // A crashed shell (killed by a signal, then a non-zero exit) is restarted; a later clean exit ends the session.
    const counter = `${directory}/starts`;
    const script = `${directory}/crashy-shell`;
    GLib.file_set_contents(script, `#!/bin/sh
n=$(cat '${counter}' 2>/dev/null || echo 0)
n=$((n + 1))
echo $n > '${counter}'
` +
        `if [ $n -eq 1 ]; then kill -9 $$; elif [ $n -eq 2 ]; then exit 3; fi
exit 0
`);
    Gio.File.new_for_path(script).set_attribute_uint32('unix::mode', 0o755, Gio.FileQueryInfoFlags.NONE, null);
    GLib.setenv('DEV_OS_SHELL', script, true);
    if (runSupervisor({restartDelaySeconds: 0.05}) !== 0) throw new Error('Supervisor did not finish cleanly after restarting a crashed shell');
    if (new TextDecoder().decode(GLib.file_get_contents(counter)[1]).trim() !== '3')
        throw new Error('Crashed shell was not restarted until it exited cleanly');
    // A shell that keeps crashing must end the session instead of looping forever.
    GLib.file_set_contents(script, `#!/bin/sh
kill -9 $$
`);
    if (runSupervisor({restartDelaySeconds: 0.01, maxRestarts: 2}) === 0) throw new Error('Crash loop did not end the session');
    print('PASS: library import has no session side effects; supervisor runs twice and restores environment');
} finally {
    keys.forEach((key, index) => previous[index] === null ? GLib.unsetenv(key) : GLib.setenv(key, previous[index]!, true));
    for (const name of ['starts', 'crashy-shell', 'dev-os']) try { Gio.File.new_for_path(`${directory}/${name}`).delete(null); } catch { /* absent */ }
    Gio.File.new_for_path(directory).delete(null);
}
