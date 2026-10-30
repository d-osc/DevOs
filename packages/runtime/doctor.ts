import {Gio, GLib} from '@dev-os/core/base';
const ROOT = GLib.getenv('DEV_OS_ROOT') ?? Gio.File.new_for_uri(import.meta.url).get_parent()!.get_parent()!.get_path()!;

/** JS/TS binding; dependency and configuration checks are implemented in DevLang. */
export async function doctor(): Promise<Record<string, boolean>> {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE});
    launcher.setenv('DEV_OS_ROOT', ROOT, true);
    const args = ['devrun', `${ROOT}/src/system/command.dev`];
    if (GLib.file_test(`${ROOT}/dist/native/libsupervisor.so`, GLib.FileTest.IS_REGULAR))
        args.push('--ffi-lib', `${ROOT}/dist/native/libsupervisor.so`);
    args.push('--', 'doctor', '--json');
    const child = launcher.spawnv(args);
    return new Promise((resolve, reject) => child.communicate_utf8_async(null, null, (_child, result) => {
        try {
            const [, output] = child.communicate_utf8_finish(result);
            const checks: unknown = JSON.parse(output ?? '');
            if (!checks || Array.isArray(checks) || typeof checks !== 'object' || !Object.values(checks).every(value => typeof value === 'boolean'))
                throw new Error('Invalid native diagnostics response');
            resolve(checks as Record<string, boolean>);
        } catch (error) {reject(error);}
    }));
}
