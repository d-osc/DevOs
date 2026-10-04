import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {historyAt, run} from './updates/service.js';
import {writeJson} from './preferences.js';

export function installedSessionRoot(): string {
    const directory = `${GLib.get_user_data_dir()}/dev-os-updates`;
    const current = historyAt(directory).current;
    if (!current) throw new Error('No installed Dev OS version is selected');
    return `${directory}/releases/${current.key}`;
}
export function sessionRequestPath(): string {
    const path = GLib.getenv('DEV_OS_VERSION_REQUEST');
    const directory = GLib.get_user_runtime_dir();
    if (!path || !path.startsWith(`${directory}/`) || !/^dev-os-version-[a-f0-9-]+\.json$/.test(path.slice(directory.length + 1)))
        throw new Error('This session manager cannot switch versions. Save your work, close this session and start .\\dev.ps1 updated or dev-os-updated-session.');
    return path;
}
export async function requestSessionVersion(root: string) {
    const request = sessionRequestPath();
    if (installedSessionRoot() !== root) throw new Error('The selected version changed. Check Updates and try again.');
    const metadata = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${root}/release.json`)[1])) as {version: string};
    if (!GLib.file_test(`${root}/bin/dev-os-start`, GLib.FileTest.IS_EXECUTABLE) || !GLib.file_test(`${root}/dist/supervisor.js`, GLib.FileTest.IS_REGULAR))
        throw new Error('Installed session manager is missing');
    const cancel = new Gio.Cancellable();
    const reported = await run([`${root}/bin/dev-os-shell`, '--version'], cancel);
    if (reported !== metadata.version) throw new Error('Installed runtime version does not match its package metadata');
    await run([`${root}/bin/dev-os-shell`, 'doctor'], cancel);
    if (installedSessionRoot() !== root) throw new Error('The selected version changed while checking dependencies. Try again.');
    writeJson(request, {root, version: metadata.version});
}
