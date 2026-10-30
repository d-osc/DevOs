import {Gio, GLib} from '@dev-os/core';
import {PowerLoading} from './power-loading.js';
export type PowerAction = 'sleep' | 'restart' | 'shutdown';
const methods = {sleep: 'Suspend', restart: 'Reboot', shutdown: 'PowerOff'} as const;
let requesting = false;
/** Every power request and its outcome goes to the journal (tag devos-power) and stderr, so a black screen after a click can be explained from the log. */
export function logPower(message: string): void {
    console.log(`devos-power: ${message}`);
    try {Gio.Subprocess.new(['logger', '-t', 'devos-power', message], Gio.SubprocessFlags.NONE);} catch { /* logger is optional */ }
}
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
/** `direct` is for the login screen, where there is no desktop to lock: Sleep is logind's Suspend itself. */
export async function powerCapabilities(direct = false): Promise<Record<PowerAction, boolean>> {
    const result = {sleep: !direct && !!GLib.find_program_in_path('dev-os-shell') && !!GLib.find_program_in_path('swaylock'), restart: false, shutdown: false};
    await Promise.all((direct ? ['sleep', 'restart', 'shutdown'] as const : ['restart', 'shutdown'] as const).map(async action => {
        try {
            const [status] = (await call(`Can${methods[action]}`, null)).deep_unpack() as [string];
            result[action] = status === 'yes' || status === 'challenge';
        } catch { /* Keep unsupported actions disabled. */ }
    }));
    return result;
}
interface PowerBackend {
    call(method: string, parameters: GLib.Variant | null): Promise<GLib.Variant>;
    loading(action: 'restart' | 'shutdown'): Pick<PowerLoading, 'ready' | 'destroy'>;
}
export async function requestPower(action: PowerAction, direct = false, backend: PowerBackend = {call, loading: action => new PowerLoading(action)}): Promise<void> {
    if (requesting) throw new Error('A power request is already in progress.');
    requesting = true;
    let loading: Pick<PowerLoading, 'ready' | 'destroy'> | undefined;
    logPower(`${action} requested${direct ? ' (login screen)' : ''}`);
    try {
        // Keep any policy authentication dialog visible before covering the desktop.
        let authorized = false;
        if (action !== 'sleep') {
            try {authorized = ((await backend.call(`Can${methods[action]}`, null)).deep_unpack() as [string])[0] === 'yes';} catch { /* logind reports the request error below */ }
            if (authorized) {loading = backend.loading(action); await loading.ready;}
        }
        await perform(action, direct, backend.call);
        if (action !== 'sleep' && !loading) loading = backend.loading(action);
    } catch (error) {
        loading?.destroy();
        if (error instanceof GLib.Error) Gio.DBusError.strip_remote_error(error); // Rewrites the message in place.
        const text = error instanceof Error || error instanceof GLib.Error ? error.message : String(error);
        logPower(`${action} failed: ${text}`);
        throw new Error(text);
    } finally {requesting = false;}
    logPower(`${action} accepted by logind`);
}
async function perform(action: PowerAction, direct: boolean, send = call): Promise<void> {
    if (action === 'sleep' && !direct) {
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
    await send(methods[action], new GLib.Variant('(b)', [!direct])); // The login screen has no visible authentication dialog: fail with a message instead.
}
