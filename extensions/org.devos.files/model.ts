import {
    Listeners, Gio, GLib
} from '@dev-os/core';
import {expandHome} from '@dev-os/config';

export interface FileEntry {name: string; label: string; path: string; directory: boolean; hidden: boolean; size: number; modified: number; icon: Gio.Icon | null;}
export interface FileState {directory: string; entries: FileEntry[]; selected: string | null; loading: boolean; busy: boolean; error: string; status: string; back: boolean; forward: boolean;}
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
export class FileBrowser {
    state: FileState = {directory: GLib.get_home_dir(), entries: [], selected: null, loading: false,
        busy: false, error: '', status: '', back: false, forward: false};
    private listeners = new Listeners();
    private history: string[] = [];
    private index = -1;
    private read: Gio.Cancellable | null = null;
    private operation: Gio.Cancellable | null = null;
    private disposed = false;
    constructor(private openFile: (uri: string, cancel: Gio.Cancellable) => Promise<void>) {}
    subscribe(listener: () => void): () => void { return this.listeners.subscribe(listener); }
    private change(next: Partial<FileState>) { if (this.disposed) return; this.state = {...this.state, ...next}; this.listeners.emit(); }
    async navigate(input: string, target?: number, replace = false): Promise<boolean> {
        if (this.disposed) return false;
        this.read?.cancel(); const cancel = new Gio.Cancellable(); this.read = cancel;
        this.change({loading: true, error: '', selected: null, status: ''});
        try {
            if (!input.trim() || input.includes('\0')) throw new Error('Enter a local folder path.');
            const path = GLib.canonicalize_filename(expandHome(input), this.state.directory);
            const entries = await readDirectory(path, cancel);
            if (cancel.is_cancelled() || this.disposed) return false;
            if (target !== undefined) this.index = target;
            else if (!replace && this.history[this.index] !== path) { this.history = [...this.history.slice(0, this.index + 1), path]; this.index++; }
            this.change({directory: path, entries, loading: false, back: this.index > 0, forward: this.index < this.history.length - 1});
            return true;
        } catch (error) { if (!cancel.is_cancelled()) this.change({loading: false, error: String(error)}); return false; }
    }
    back() { if (this.index > 0) return this.navigate(this.history[this.index - 1], this.index - 1); return Promise.resolve(false); }
    forward() { if (this.index + 1 < this.history.length) return this.navigate(this.history[this.index + 1], this.index + 1); return Promise.resolve(false); }
    refresh() { return this.navigate(this.state.directory, undefined, true); }
    up() { return this.navigate(Gio.File.new_for_path(this.state.directory).get_parent()?.get_path() ?? '/'); }
    select(path: string | null) { if (path !== this.state.selected) this.change({selected: path}); }
    async open(entry: FileEntry): Promise<boolean> {
        if (entry.directory) return this.navigate(entry.path);
        return this.perform(cancel => this.openFile(Gio.File.new_for_path(entry.path).get_uri(), cancel));
    }
    openPath(path: string): Promise<boolean> {
        return this.perform(cancel => this.openFile(Gio.File.new_for_path(path).get_uri(), cancel));
    }
    private async perform(action: (cancel: Gio.Cancellable) => Promise<void>): Promise<boolean> {
        if (this.state.busy || this.disposed) return false;
        const cancel = new Gio.Cancellable(); this.operation = cancel;
        this.change({busy: true, error: ''});
        try { await action(cancel); return !this.disposed; }
        catch (error) { if (!cancel.is_cancelled()) this.change({error: String(error)}); return false; }
        finally { this.change({busy: false}); this.operation = null; }
    }
    createFolder(name: string): Promise<boolean> {
        const directory = this.state.directory;
        return this.perform(async cancel => {
            const target = Gio.File.new_for_path(directory).get_child(validName(name));
            await new Promise<void>((resolve, reject) => target.make_directory_async(priority, cancel, (_source, result) => {
                try { target.make_directory_finish(result); resolve(); } catch (error) { reject(error); }
            }));
            if (!this.disposed && this.state.directory === directory) { await this.refresh(); this.select(target.get_path()); this.change({status: 'Folder created'}); }
        });
    }
    rename(name: string): Promise<boolean> {
        const selected = this.state.entries.find(entry => entry.path === this.state.selected);
        const directory = this.state.directory;
        return this.perform(async cancel => {
            if (!selected) throw new Error('Select a file or folder first.');
            const target = Gio.File.new_for_path(directory).get_child(validName(name));
            const source = Gio.File.new_for_path(selected.path);
            await new Promise<void>((resolve, reject) => source.move_async(target, Gio.FileCopyFlags.NONE, priority, cancel, null, (_source, result) => {
                try { source.move_finish(result); resolve(); } catch (error) { reject(error); }
            }));
            if (!this.disposed && this.state.directory === directory) { await this.refresh(); this.select(target.get_path()); this.change({status: 'Name changed'}); }
        });
    }
    dispose() { this.disposed = true; this.read?.cancel(); this.operation?.cancel(); this.listeners.clear(); }
}
