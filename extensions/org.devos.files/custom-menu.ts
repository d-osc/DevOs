import {Gio, GLib} from '@dev-os/core';
export const customMenuTargets = ['any', 'file', 'folder', 'background'] as const;
export interface CustomMenuItem {id: string; title: string; command: string; enabled: boolean; target: typeof customMenuTargets[number];}
export function customCommandArguments(command: string, path: string, directory: string) {
    if (!command.trim() || command.length > 2000 || command.includes('\0')) throw new Error('Enter a command of up to 2,000 characters.');
    const [ok, arguments_] = GLib.shell_parse_argv(command);
    if (!ok || !arguments_?.length) throw new Error('Enter a valid command with balanced quotes.');
    return arguments_.map(argument => argument.replace(/\{path\}|\{directory\}/g, token => token === '{path}' ? path : directory));
}
export function parseCustomMenu(value: unknown): CustomMenuItem[] {
    if (value === undefined || value === '') return [];
    if (typeof value !== 'string' || value.length > 150000) throw new Error('Custom actions must be a JSON list.');
    const entries: unknown = JSON.parse(value);
    if (!Array.isArray(entries) || entries.length > 50) throw new Error('Use up to 50 custom actions.');
    const ids = new Set<string>();
    return entries.map(entry => {
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^custom-[a-zA-Z0-9-]{1,80}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Custom actions need unique custom IDs. Default actions cannot be replaced.');
        if (typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 80 || entry.title.includes('\0')) throw new Error('Enter a menu name of 1–80 characters.');
        if (!customMenuTargets.includes(entry.target) || typeof entry.enabled !== 'boolean' || typeof entry.command !== 'string') throw new Error('Custom action settings are invalid.');
        customCommandArguments(entry.command, '/preview/item', '/preview'); ids.add(entry.id);
        return {id: entry.id, title: entry.title.trim(), command: entry.command, enabled: entry.enabled, target: entry.target};
    });
}
export function customMenuMatches(item: CustomMenuItem, target: 'file' | 'folder' | 'background') {
    return item.enabled && (item.target === 'any' || item.target === target);
}
export function runCustomMenuItem(item: CustomMenuItem, path: string, directory: string, failed: (message: string) => void) {
    try {
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE}); launcher.set_cwd(directory);
        const process = launcher.spawnv(customCommandArguments(item.command, path, directory));
        process.wait_check_async(null, (_process, result) => {
            try {process.wait_check_finish(result);} catch (error) {failed(`${item.title}: ${String(error)}`);}
        });
    } catch (error) {failed(`${item.title}: ${String(error)}`);}
}
