import {Gio, GLib} from '@dev-os/core/base';
import {browserUri} from './navigation.js';

/** WebKit already owns its network/content processes; this worker owns filesystem operations. */
export class BrowserData {
    private downloads = new Map<string, {partial: Gio.File; target: Gio.File; overwrite: boolean}>();
    async navigate(input: string) {return browserUri(input);}
    async prepare(path: string) {
        const id = GLib.uuid_string_random(), target = Gio.File.new_for_path(path);
        const partial = Gio.File.new_for_path(`${path}.${id}.part`);
        this.downloads.set(id, {partial, target, overwrite: target.query_exists(null)});
        return {id, uri: partial.get_uri(), name: target.get_basename()};
    }
    async commit(id: string) {
        const download = this.downloads.get(id); if (!download) throw new Error('Download was cancelled.');
        await new Promise<void>((resolve, reject) => download.partial.move_async(download.target,
            download.overwrite ? Gio.FileCopyFlags.OVERWRITE : Gio.FileCopyFlags.NONE,
            GLib.PRIORITY_DEFAULT, null, null, (_file, result) => {
                try {download.partial.move_finish(result); resolve();} catch (error) {reject(error);}
            }));
        this.downloads.delete(id);
    }
    async cancel(id: string) {
        const download = this.downloads.get(id); if (!download) return;
        this.downloads.delete(id);
        try {download.partial.delete(null);} catch (error) {if (download.partial.query_exists(null)) throw error;}
    }
    destroy() {for (const id of this.downloads.keys()) void this.cancel(id).catch(() => {});}
}
