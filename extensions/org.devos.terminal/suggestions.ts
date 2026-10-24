export interface CommandInput {line: string; point: number; directory: string; history: string[]; commands: string[];}
export interface Suggestion {label: string; detail: string; line: string; point: number; kind: 'command' | 'history' | 'argument' | 'folder' | 'file';}
const encoder = new TextEncoder(), decoder = new TextDecoder();
export const byteLength = (text: string) => encoder.encode(text).length;
export function splitInput(input: CommandInput) {
    const bytes = encoder.encode(input.line);
    return [decoder.decode(bytes.slice(0, input.point)), decoder.decode(bytes.slice(input.point))];
}
const arguments_: Record<string, Record<string, string>> = {
    git: {status: 'Show working tree changes', diff: 'Inspect changes', log: 'Show commit history', add: 'Stage files', commit: 'Create a commit', branch: 'List or manage branches', switch: 'Switch branches', checkout: 'Switch branches or restore files', pull: 'Fetch and integrate changes', push: 'Push commits', fetch: 'Fetch remote changes', clone: 'Clone a repository', restore: 'Restore working tree files'},
    npm: {install: 'Install dependencies', run: 'Run a package script', test: 'Run tests', start: 'Start the application', ci: 'Install locked dependencies', build: 'Build the package', init: 'Create package.json'},
    systemctl: {status: 'Show service status', start: 'Start a service', stop: 'Stop a service', restart: 'Restart a service', enable: 'Enable at boot', disable: 'Disable at boot', 'list-units': 'List units', 'list-unit-files': 'List installed units'},
    ip: {address: 'Show or configure addresses', link: 'Show or configure interfaces', route: 'Show or configure routes'},
    nmcli: {device: 'Manage network devices', connection: 'Manage saved connections', general: 'Show network status', radio: 'Manage wireless radios'},
    docker: {ps: 'List containers', images: 'List images', run: 'Create and start a container', compose: 'Manage compose services', logs: 'Show container logs', exec: 'Run a command in a container'},
};
export function commandSuggestions(input: CommandInput): Suggestion[] {
    const [before, after] = splitInput(input), result: Suggestion[] = [];
    if (!before.trim() || /[\r\n\x00-\x1f]/.test(input.line)) return [];
    const add = (label: string, detail: string, line: string, point: number, kind: Suggestion['kind']) => {
        if (line !== input.line && !result.some(item => item.line === line)) result.push({label, detail, line, point, kind});
    };
    // Full-command history is offered only at the end; preserve the untouched suffix.
    if (!after) for (const command of input.history.slice().reverse()) {
        if (command.startsWith(before) && command.length <= 4096 && !/[\r\n\x00-\x1f]/.test(command)) add(command, 'History', command, byteLength(command), 'history');
    }
    const match = before.match(/^(\s*)([\w.+-]*)$/);
    if (match && !/^[\w.+-]/.test(after)) {
        for (const command of [...new Set(input.commands)].sort()) {
            if (command.startsWith(match[2]) && /^[\w.+-]+$/.test(command) && !command.startsWith('__devos_')) {
                const prefix = `${match[1]}${command}${after ? '' : ' '}`;
                add(command, 'Command', prefix + after, byteLength(prefix), 'command');
            }
        }
    } else {
        const words = before.trimStart().split(/\s+/);
        if (words.length === 2 && !/[\w.+-]/.test(after[0] ?? '')) for (const [value, detail] of Object.entries(arguments_[words[0]] ?? {})) {
            if (value.startsWith(words[1])) {
                const prefix = before.slice(0, before.length - words[1].length) + value + (after ? '' : ' ');
                add(value, detail, prefix + after, byteLength(prefix), 'argument');
            }
        }
    }
    return result.slice(0, 8);
}
// Restrict automatic path completion to unquoted words. Complex shell syntax
// continues to use Bash's own Tab completion rather than guessing its meaning.
export function pathPrefix(input: CommandInput) {
    const [before, after] = splitInput(input);
    if (after && !/^\s/.test(after) || /["'`$\\;|&()<>\r\n]/.test(before)) return;
    const token = before.match(/(?:^|\s)([^\s]*)$/)?.[1];
    if (token === undefined || !/\s/.test(before) && !token.includes('/')) return;
    const slash = token.lastIndexOf('/'), parent = slash < 0 ? '' : token.slice(0, slash + 1), prefix = token.slice(slash + 1);
    const absolute = parent.startsWith('/') ? parent : `${input.directory}/${parent}`;
    return {before, after, token, parent, prefix, absolute, directoriesOnly: /^\s*cd\s/.test(before)};
}
