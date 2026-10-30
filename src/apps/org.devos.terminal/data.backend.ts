import {Gio, GLib, removeTree} from '@dev-os/core/base';
import {bashIntegration} from './shell-integration.js';
import {byteLength, commandSuggestions, pathPrefix, type CommandInput, type Suggestion} from './suggestions.js';
export class TerminalData {
    readonly directory = GLib.dir_make_tmp('devos-terminal-XXXXXX');
    private commandsStamp = 0;
    private lastSnapshot = '';
    private commandNames: string[] = [];
    private monitor: Gio.FileMonitor;
    constructor(private changed: (fields: string[]) => void) {
        GLib.file_set_contents(`${this.directory}/init.bash`, bashIntegration);
        this.monitor = Gio.File.new_for_path(this.directory).monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this.monitor.connect('changed', (_monitor, file, other) => {
            const names = [file.get_basename(), other?.get_basename()];
            if (names.includes('commands')) {this.changed(['catalog']); return;}
            if (!names.includes('state')) return;
            try {const text = new TextDecoder().decode(GLib.file_get_contents(`${this.directory}/state`)[1]); if (text === this.lastSnapshot) return; this.lastSnapshot = text; this.changed(text.split('\0'));} catch {}
        });
    }
    async initialize() {return this.directory;}
    async beginQuery() {this.lastSnapshot = '';}
    async suggest(fields: string[]) {
        const point = Number(fields[2]);
        if (!Number.isInteger(point) || point < 0 || point > byteLength(fields[1])) throw new Error('Invalid shell input.');
        const input: CommandInput = {line: fields[1], point, directory: fields[3], history: fields[4].split('\n').map(line => line.replace(/^\s*\d+[* ]?\s+/, '')).filter(Boolean), commands: this.commands()};
        const items = commandSuggestions(input);
        const paths = await this.paths(input, new Gio.Cancellable()).catch(() => []);
        return {input, items: [...items, ...paths.filter(path => !items.some(item => item.line === path.line))].slice(0, 8)};
    }
    async accept(input: CommandInput, item: Suggestion) {
        GLib.file_set_contents(`${this.directory}/accept`, [input.line, String(input.point), item.line, String(item.point), ''].join('\0'));
    }
    private commands(): string[] {
        try {
            const file = Gio.File.new_for_path(`${this.directory}/commands`), stamp = file.query_info('time::modified-usec,time::modified', Gio.FileQueryInfoFlags.NONE, null).get_modification_date_time()?.to_unix_usec() ?? 0;
            if (stamp !== this.commandsStamp) {
                this.commandsStamp = stamp;
                this.commandNames = new TextDecoder().decode(GLib.file_get_contents(file.get_path()!)[1]).split('\n').filter(Boolean);
            }
        } catch {return this.commandNames;}
        return this.commandNames;
    }
    private async paths(input: CommandInput, cancel: Gio.Cancellable): Promise<Suggestion[]> {
        const part = pathPrefix(input); if (!part || input.line.length > 4096) return [];
        const directory = Gio.File.new_for_path(part.absolute);
        const enumerator = await new Promise<Gio.FileEnumerator>((resolve, reject) => directory.enumerate_children_async('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancel, (file, result) => {
            try {resolve(file!.enumerate_children_finish(result));} catch (error) {reject(error);}
        }));
        const entries: {name: string; folder: boolean}[] = [];
        try {
            for (let count = 0; count < 2000; count += 100) {
                const batch = await new Promise<Gio.FileInfo[]>((resolve, reject) => enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, cancel, (source, result) => {
                    try {resolve(source!.next_files_finish(result));} catch (error) {reject(error);}
                }));
                for (const info of batch) {
                    const name = info.get_name(), folder = info.get_file_type() === Gio.FileType.DIRECTORY;
                    if (name.startsWith(part.prefix) && (!name.startsWith('.') || part.prefix.startsWith('.')) && (!part.directoriesOnly || folder) && !/[\r\n\x00-\x1f]/.test(name)) entries.push({name, folder});
                }
                if (batch.length < 100 || entries.length >= 32) break;
            }
        } finally {enumerator.close(null);}
        return entries.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name)).slice(0, 8).map(({name, folder}): Suggestion => {
            const word = (part.parent + name).replace(/[^\w./+@%-]/g, '\\$&') + (folder ? '/' : ' ');
            const prefix = part.before.slice(0, part.before.length - part.token.length) + word;
            return {label: part.parent + name + (folder ? '/' : ''), detail: folder ? 'Folder' : 'File', kind: folder ? 'folder' : 'file', line: prefix + part.after, point: byteLength(prefix)};
        }).filter(item => item.line !== input.line);
    }
    destroy() {this.monitor.cancel(); removeTree(this.directory);}
}
