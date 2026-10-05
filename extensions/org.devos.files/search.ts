import {
    Listeners, Gio, GLib
} from '@dev-os/core';

export const DEFAULT_SEARCH_EXCLUDES = '.git,node_modules,dist,build,.venv,vendor,.cache';
export interface SearchFile {name: string; path: string; relative: string;}
export interface SearchState {
    root: string; query: string; results: SearchFile[]; matches: number; indexed: number;
    scanning: boolean; pending: boolean; limited: boolean; skipped: number; error: string;
}
export interface SearchOptions {excludedDirectories: string[]; maxEntries?: number; maxResults?: number;}

// Prefer file names, then relative paths. Consecutive letters and word boundaries
// rank above scattered subsequences, so "fvtsx" can find "files-view.tsx".
function fuzzyScore(text: string, query: string): number | null {
    if (text === query) return 1000;
    if (text.startsWith(query)) return 700 - text.length;
    const substring = text.indexOf(query);
    if (substring >= 0) return 500 - substring * 2 - text.length;
    let position = -1, score = 100;
    for (const letter of query) {
        const next = text.indexOf(letter, position + 1);
        if (next < 0) return null;
        score += next === position + 1 ? 12 : -(next - position);
        if (next === 0 || '/._- '.includes(text[next - 1])) score += 10;
        position = next;
    }
    return score - text.length;
}
export function matchFiles(files: readonly SearchFile[], query: string, limit = 100) {
    const tokens = query.trim().toLowerCase().replaceAll('\\', '/').split(/\s+/).filter(Boolean);
    const ranked: {file: SearchFile; score: number}[] = [];
    for (const file of files) {
        let score = 0, matched = true;
        for (const token of tokens) {
            const name = fuzzyScore(file.name.toLowerCase(), token);
            const path = name === null ? fuzzyScore(file.relative.toLowerCase(), token) : null;
            if (name === null && path === null) { matched = false; break; }
            score += name !== null ? name + 200 : path!;
        }
        if (matched) ranked.push({file, score});
    }
    ranked.sort((a, b) => b.score - a.score || (tokens.length ? a.file.relative.length - b.file.relative.length : 0) || a.file.relative.localeCompare(b.file.relative));
    return {results: ranked.slice(0, limit).map(item => item.file), matches: ranked.length};
}

export class FileSearch {
    state: SearchState = {root: '', query: '', results: [], matches: 0, indexed: 0,
        scanning: false, pending: false, limited: false, skipped: 0, error: ''};
    private files: SearchFile[] = [];
    private listeners = new Listeners();
    private cancel: Gio.Cancellable | null = null;
    private timer = 0;
    private limit = 100;
    private disposed = false;
    subscribe(listener: () => void) { return this.listeners.subscribe(listener); }
    private change(next: Partial<SearchState>) {
        if (this.disposed) return;
        this.state = {...this.state, ...next};
        this.listeners.emit();
    }
    private publish(next: Partial<SearchState> = {}) {
        this.change({...(!this.state.pending ? matchFiles(this.files, this.state.query, this.limit) : {}), indexed: this.files.length, ...next});
    }
    setQuery(query: string) {
        if (this.disposed) return;
        if (this.timer) GLib.source_remove(this.timer);
        this.change({query, pending: true});
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this.timer = 0;
            this.change({...matchFiles(this.files, this.state.query, this.limit), pending: false});
            return GLib.SOURCE_REMOVE;
        });
    }
    async start(root: string, options: SearchOptions): Promise<void> {
        if (this.disposed) return;
        this.stop();
        const cancel = new Gio.Cancellable(); this.cancel = cancel;
        this.files = []; this.limit = options.maxResults ?? 100;
        this.change({root, query: '', results: [], matches: 0, indexed: 0, scanning: true, pending: false, limited: false, skipped: 0, error: ''});
        const excluded = new Set(options.excludedDirectories), queue = [root];
        let visited = 0, skipped = 0, limited = false, lastPublish = 0;
        const maxEntries = options.maxEntries ?? 30000;
        try {
            for (let index = 0; index < queue.length && !limited; index++) {
                if (cancel.is_cancelled()) return;
                const directory = Gio.File.new_for_path(queue[index]);
                let enumerator: Gio.FileEnumerator;
                try {
                    enumerator = await new Promise<Gio.FileEnumerator>((resolve, reject) => {
                        directory.enumerate_children_async('standard::name,standard::type,standard::is-symlink',
                            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancel, (_source, result) => {
                                try { resolve(directory.enumerate_children_finish(result)); } catch (error) { reject(error); }
                            });
                    });
                } catch (error) {
                    if (cancel.is_cancelled()) return;
                    if (index === 0) throw error;
                    skipped++; continue;
                }
                try {
                    while (!limited) {
                        const batch = await new Promise<Gio.FileInfo[]>((resolve, reject) => {
                            enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, cancel, (_source, result) => {
                                try { resolve(enumerator.next_files_finish(result) ?? []); } catch (error) { reject(error); }
                            });
                        });
                        if (cancel.is_cancelled()) return;
                        if (!batch.length) break;
                        for (const info of batch) {
                            if (++visited > maxEntries) { limited = true; break; }
                            const name = info.get_name(), path = directory.get_child(name).get_path()!;
                            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                                if (!info.get_is_symlink() && !excluded.has(name)) queue.push(path);
                            } else if (info.get_file_type() === Gio.FileType.REGULAR || info.get_file_type() === Gio.FileType.SYMBOLIC_LINK) {
                                this.files.push({name, path, relative: root === '/' ? path.slice(1) : path.slice(root.length + 1)});
                            }
                        }
                        const now = GLib.get_monotonic_time();
                        if (now - lastPublish > 100000) { this.publish({skipped}); lastPublish = now; }
                    }
                } catch (error) {
                    if (cancel.is_cancelled()) return;
                    if (index === 0) throw error;
                    skipped++;
                } finally {
                    await new Promise<void>((resolve) => enumerator.close_async(GLib.PRIORITY_DEFAULT, null, (_source, result) => {
                        try { enumerator.close_finish(result); } catch { /* Already cancelled or removed. */ }
                        resolve();
                    }));
                }
            }
            if (!cancel.is_cancelled()) this.publish({scanning: false, limited, skipped});
        } catch (error) {
            if (!cancel.is_cancelled()) this.publish({scanning: false, error: String(error)});
        }
    }
    stop() {
        this.cancel?.cancel(); this.cancel = null;
        if (this.timer) { GLib.source_remove(this.timer); this.timer = 0; }
        this.change({scanning: false, pending: false});
    }
    dispose() { this.stop(); this.disposed = true; this.listeners.clear(); }
}
