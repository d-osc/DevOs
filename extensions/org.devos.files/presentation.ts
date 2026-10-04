import {GLib} from '../../src/gtk.js';
import type {FileEntry} from './model.js';

export function fileKind(entry: FileEntry): {label: string; tag: string; color: string} {
    if (entry.directory) {
        if (['node_modules', 'vendor', '.venv'].includes(entry.name)) return {label: 'Dependencies', tag: 'DEP', color: 'neutral'};
        if (entry.name === '.git') return {label: 'Git metadata', tag: 'GIT', color: 'orange'};
        return {label: 'Folder', tag: 'DIR', color: 'mint'};
    }
    const extension = entry.name.split('.').pop()?.toLowerCase() ?? '';
    const kinds: Record<string, [string, string, string]> = {
        ts: ['TypeScript', 'TS', 'blue'], tsx: ['React / TSX', 'TSX', 'blue'],
        js: ['JavaScript', 'JS', 'yellow'], jsx: ['React / JSX', 'JSX', 'yellow'],
        json: ['JSON', '{}', 'yellow'], yaml: ['YAML', 'YML', 'orange'], yml: ['YAML', 'YML', 'orange'],
        md: ['Markdown', 'MD', 'purple'], css: ['Stylesheet', 'CSS', 'purple'], scss: ['Stylesheet', 'CSS', 'purple'],
        html: ['HTML', 'HTML', 'orange'], py: ['Python', 'PY', 'blue'], rs: ['Rust', 'RS', 'orange'],
        go: ['Go', 'GO', 'blue'], sh: ['Shell script', 'SH', 'mint'], toml: ['TOML', 'TOML', 'orange'],
        svg: ['Vector image', 'SVG', 'purple'], png: ['Image', 'IMG', 'purple'], jpg: ['Image', 'IMG', 'purple'],
    };
    if (entry.name.startsWith('.env') || ['Dockerfile', 'Makefile', '.gitignore'].includes(entry.name))
        return {label: 'Configuration', tag: 'CFG', color: 'neutral'};
    const [label, tag, color] = kinds[extension] ?? ['File', extension.toUpperCase().slice(0, 5) || 'FILE', 'neutral'];
    return {label, tag, color};
}
export function modifiedLabel(seconds: number): string {
    return seconds > 0 ? GLib.DateTime.new_from_unix_local(seconds)?.format('%d %b  %H:%M') ?? '—' : '—';
}
export function compactPath(path: string): string {
    const home = GLib.get_home_dir();
    return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
