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
    const result = {sleep: false, restart: false, shutdown: false};
    await Promise.all((Object.keys(methods) as PowerAction[]).map(async action => {
        try {
            const [status] = (await call(`Can${methods[action]}`, null)).deep_unpack() as [string];
            result[action] = status === 'yes' || status === 'challenge';
        } catch { /* Keep unsupported actions disabled. */ }
    }));
    return result;
}
export async function requestPower(action: PowerAction): Promise<void> {
    await call(methods[action], new GLib.Variant('(b)', [true]));
}
