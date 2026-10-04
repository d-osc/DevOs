import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function writeJson(path: string, value: unknown): void {
    const file = Gio.File.new_for_path(path), parent = file.get_parent()!;
    if (GLib.mkdir_with_parents(parent.get_path()!, 0o700) !== 0) throw new Error('Cannot create settings directory');
    file.replace_contents(new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'),
        null, false, Gio.FileCreateFlags.PRIVATE, null);
}
