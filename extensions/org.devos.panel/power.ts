import {Gio, GLib} from '@dev-os/core';
export type PowerAction = 'sleep' | 'restart' | 'shutdown';
const methods = {sleep: 'Suspend', restart: 'Reboot', shutdown: 'PowerOff'} as const;
// logind enforces session policy and inhibitors without shell commands.
function call(method: string, parameters: GLib.Variant | null): Promise<GLib.Variant> {
    return new Promise((resolve, reject) => {
        Gio.DBus.system.call('org.freedesktop.login1', '/org/freedesktop/login1',
            'org.freedesktop.login1.Manager', method, parameters, null,
            Gio.DBusCallFlags.NONE, 60000, null, (connection, result) => {
                try {resolve(connection!.call_finish(result));} catch (error) {reject(error);}
            });
    });
}
export async function powerCapabilities(): Promise<Record<PowerAction, boolean>> {
    const result = {sleep: !!GLib.find_program_in_path('dev-os-shell') && !!GLib.find_program_in_path('swaylock'), restart: false, shutdown: false};
    await Promise.all((['restart', 'shutdown'] as const).map(async action => {
        try {
            const [status] = (await call(`Can${methods[action]}`, null)).deep_unpack() as [string];
            result[action] = status === 'yes' || status === 'challenge';
        } catch { /* Keep unsupported actions disabled. */ }
    }));
    return result;
}
export async function requestPower(action: PowerAction): Promise<void> {
    if (action === 'sleep') {
        const process = Gio.Subprocess.new(['dev-os-shell', 'lock'], Gio.SubprocessFlags.STDERR_PIPE);
        await new Promise<void>((resolve, reject) => process.communicate_utf8_async(null, null, (source, result) => {
            try {
                const [, , error] = source!.communicate_utf8_finish(result);
                if (!process.get_successful()) throw new Error(error || 'Could not lock the screen');
                resolve();
            } catch (error) { reject(error); }
        }));
        return;
    }
    await call(methods[action], new GLib.Variant('(b)', [true]));
}
