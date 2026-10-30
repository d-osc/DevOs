import {Gio} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';

/** One-shot data requests. Never use the replay/coalescing model channel for edits. */
export function devlangData<T>(source: string, request: object, cancel: Gio.Cancellable | null = null): Promise<T> {
    const input = JSON.stringify(request) + '\n';
    if (new TextEncoder().encode(input).length > 4 * 1024 * 1024) return Promise.reject(new Error('Data request exceeds 4 MiB.'));
    const child = Gio.Subprocess.new(['d', `${ROOT}/${source}`], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    return new Promise((resolve, reject) => child.communicate_utf8_async(input, cancel, (_child, result) => {
        try {
            const [, output, error] = child.communicate_utf8_finish(result);
            if (!child.get_successful()) throw new Error(error || 'DevLang data service stopped.');
            if (!output || new TextEncoder().encode(output).length > 4 * 1024 * 1024) throw new Error('Invalid DevLang data response.');
            const value = JSON.parse(output);
            if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid DevLang data response.');
            if (typeof value.error === 'string') throw new Error(value.error);
            resolve(value as T);
        } catch (error) {child.force_exit(); reject(error);}
    }));
}
