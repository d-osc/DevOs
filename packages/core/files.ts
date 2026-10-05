import {Gio, GLib} from './native.js';

export function readText(path: string): string {
    const [ok, contents] = GLib.file_get_contents(path);
    if (!ok) throw new Error(`Cannot read ${path}`);
    return new TextDecoder().decode(contents);
}
export function readJson<T = unknown>(path: string): T { return JSON.parse(readText(path)) as T; }
export function writeJson(path: string, value: unknown): void {
    const file = Gio.File.new_for_path(path), parent = file.get_parent()!;
    if (GLib.mkdir_with_parents(parent.get_path()!, 0o700) !== 0) throw new Error('Cannot create settings directory');
    file.replace_contents(new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'),
        null, false, Gio.FileCreateFlags.PRIVATE, null);
}

export function removeTree(path: string) {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null)) return;
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
        const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        try { for (let child = children.next_file(null); child; child = children.next_file(null)) removeTree(`${path}/${child.get_name()}`); }
        finally { children.close(null); }
    }
    file.delete(null);
}
