import {serviceClass} from '@dev-os/runtime/app-service';
import {
    Listeners, Gio, GLib
} from '@dev-os/core';
import {expandHome} from '@dev-os/config';

export interface FileEntry {name: string; label: string; path: string; directory: boolean; hidden: boolean; size: number; modified: number; icon: Gio.Icon | null;}
export interface FileViews {all: FileEntry[]; normal: FileEntry[]; allFolders: FileEntry[]; normalFolders: FileEntry[];}
export interface FileState {views?: FileViews; directory: string; entries: FileEntry[]; selected: string | null; loading: boolean; busy: boolean; error: string; status: string; back: boolean; forward: boolean;}
const priority = GLib.PRIORITY_DEFAULT;
const attributes = 'standard::name,standard::display-name,standard::type,standard::size,standard::icon,standard::is-hidden,time::modified';
const compareFileNames = new Intl.Collator(undefined, {numeric: true}).compare;
export function validName(name: string): string {
    if (!name.trim() || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) throw new Error('Enter a file name without / or special path components.');
    return name;
}
export async function readDirectory(path: string, cancel: Gio.Cancellable): Promise<FileEntry[]> {
    const file = Gio.File.new_for_path(path);
    const enumerator = await new Promise<Gio.FileEnumerator>((resolve, reject) => {
        file.enumerate_children_async(attributes, Gio.FileQueryInfoFlags.NONE, priority, cancel, (_file, result) => {
            try { resolve(file.enumerate_children_finish(result)); } catch (error) { reject(error); }
        });
    });
    const entries: FileEntry[] = [];
    try {
        for (;;) {
            const batch = await new Promise<Gio.FileInfo[]>((resolve, reject) => {
                enumerator.next_files_async(100, priority, cancel, (_source, result) => {
                    try { resolve(enumerator.next_files_finish(result) ?? []); } catch (error) { reject(error); }
                });
            });
            if (!batch.length) break;
            for (const info of batch) entries.push({name: info.get_name(), label: info.get_display_name(),
                path: file.get_child(info.get_name()).get_path()!, directory: info.get_file_type() === Gio.FileType.DIRECTORY,
                hidden: info.get_is_hidden(), size: info.get_size(), modified: info.get_attribute_uint64('time::modified'), icon: info.get_icon()});
        }
    } finally {
        await new Promise<void>((resolve, reject) => enumerator.close_async(priority, null, (_source, result) => {
            try { enumerator.close_finish(result); resolve(); } catch (error) { reject(error); }
        }));
    }
    return entries.sort((a, b) => Number(b.directory) - Number(a.directory) || compareFileNames(a.label, b.label));
}
export type FileBrowser = import('./model.backend.js').FileBrowser;
export const FileBrowser = serviceClass<typeof import('./model.backend.js').FileBrowser>('files/model.FileBrowser', {state: {directory: GLib.get_home_dir(), entries: [], selected: null, loading: false,
        busy: false, error: '', status: '', back: false, forward: false}}, ["select"]);
