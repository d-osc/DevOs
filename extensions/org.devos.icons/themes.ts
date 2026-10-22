import {Gtk, Gio} from '@dev-os/core';
export function installedIconThemes(theme: Gtk.IconTheme): string[] {
    const names = new Set<string>();
    for (const path of theme.get_search_path() ?? []) {
        const directory = Gio.File.new_for_path(path);
        if (!directory.query_exists(null)) continue;
        let files: Gio.FileEnumerator;
        try {files = directory.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);} catch {continue;}
        try {
            for (let file = files.next_file(null); file; file = files.next_file(null)) {
                if (directory.get_child(file.get_name()).get_child('index.theme').query_exists(null)) names.add(file.get_name());
            }
        } finally {files.close(null);}
    }
    return [...names].sort();
}
