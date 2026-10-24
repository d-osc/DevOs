import {readJson, Gio, GLib} from '@dev-os/core/base';
import {repository, version} from './protocol.js';
// Kept apart from service.ts so the session supervisor can read the install history without loading Soup.
export interface Installed {key: string; version: string; repository: string; platform: string;}
export interface History {current: Installed | null; previous: Installed | null;}
export function run(args: string[], cancel: Gio.Cancellable, timeoutSeconds = 60): Promise<string> {
    return new Promise((resolve, reject) => {
        let process: Gio.Subprocess;
        try { process = Gio.Subprocess.new(args, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); }
        catch (error) { reject(error); return; }
        const cancelled = cancel.connect(() => process.force_exit());
        const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => { process.force_exit(); return GLib.SOURCE_REMOVE; });
        let timedOut = false;
        // The timeout is also tracked to avoid removing an already-fired GLib source.
        GLib.Source.set_name_by_id(timeout, 'dev-os-update-process');
        const source = GLib.MainContext.default().find_source_by_id(timeout);
        process.communicate_utf8_async(null, cancel, (_source, result) => {
            if (source && !source.is_destroyed()) source.destroy(); else timedOut = true;
            cancel.disconnect(cancelled);
            try {
                const [, stdout, stderr] = process.communicate_utf8_finish(result);
                if (timedOut) throw new Error('Update operation timed out. Try again.');
                if (!process.get_successful()) throw new Error(stderr?.trim() || `${args[0]} failed`);
                resolve(stdout?.trimEnd() ?? '');
            } catch (error) { reject(error); }
        });
    });
}
export function historyAt(root: string): History {
    if (!GLib.file_test(`${root}/history.json`, GLib.FileTest.EXISTS)) return {current: null, previous: null};
    const history = readJson<History>(`${root}/history.json`);
    if (!history || !Object.hasOwn(history, 'current') || !Object.hasOwn(history, 'previous')) throw new Error('Invalid installed update history');
    for (const record of [history.current, history.previous]) {
        if (record === null) continue;
        if (!record || typeof record !== 'object' || !['linux-x64', 'linux-arm64'].includes(record.platform))
            throw new Error('Invalid installed update history');
        if (!/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(record.key) || !record.key.startsWith(`${version(record.version)}-`))
            throw new Error('Invalid installed update history');
        repository(record.repository);
        const metadata = readJson<Record<string, unknown>>(`${root}/releases/${record.key}/release.json`);
        if (metadata.format !== 1 || metadata.version !== record.version || metadata.platform !== record.platform)
            throw new Error('Installed release metadata does not match update history');
    }
    return history;
}
