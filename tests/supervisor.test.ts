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
    print('PASS: library import has no session side effects; supervisor runs twice and restores environment');
} finally {
    keys.forEach((key, index) => previous[index] === null ? GLib.unsetenv(key) : GLib.setenv(key, previous[index]!, true));
    Gio.File.new_for_path(directory).delete(null);
}
