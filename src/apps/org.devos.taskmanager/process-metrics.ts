const roles: Record<string, string> = {settings: 'Settings', files: 'Files', terminal: 'Terminal', editor: 'Editor', camera: 'Camera', microphone: 'Microphone', taskmanager: 'Task Manager', browser: 'Browser', diskmanager: 'Disk Manager', appstore: 'App Store', installer: 'Installer', screenshot: 'Screenshot'};

export function processIdentity(args: string[], fallback: string, root?: string): {name: string; command: string; executable: string} {
    const executable = args[0]?.split('/').pop() || fallback;
    const script = args.findIndex(value => /\/(?:app-host|app-service-host|services-host|main|supervisor)\.js$/.test(value));
    let name = fallback;
    if (['gjs', 'gjs-console'].includes(executable) && script >= 0 && (!root || args[script].startsWith(`${root}/dist/`))) {
        const file = args[script].split('/').pop();
        if (file === 'app-host.js' || file === 'app-service-host.js') {
            const role = args[script + 1];
            name = `${roles[role] || role || 'DevOs App'} · ${file === 'app-host.js' ? 'UI' : 'Service'}`;
        } else name = file === 'main.js' ? 'DevOs · Desktop' : file === 'services-host.js' ? 'DevOs · System Services' : 'DevOs · Supervisor';
    } else if (['gjs', 'gjs-console'].includes(executable)) {
        name = `GJS · ${args.find(value => /\.js$/.test(value))?.split('/').pop() || 'JavaScript'}`;
    } else if (['d', 'devrun', 'python', 'python3', 'sh', 'bash'].includes(executable)) {
        const script = args.find(value => /(?:^|\/)(?:dev-os-[\w-]+|[\w-]+\.(?:py|dev|sh))$/.test(value));
        if (script) name = script.split('/').pop()!;
    }
    return {name, command: args.join(' '), executable};
}

export function swapBytes(status: string): number | null {
    const match = /^VmSwap:\s+(\d+)\s+kB$/m.exec(status);
    return match ? Number(match[1]) * 1024 : null;
}
export function diskCounters(text: string): {read: number; write: number} | null {
    const read = /^read_bytes:\s+(\d+)$/m.exec(text), write = /^write_bytes:\s+(\d+)$/m.exec(text);
    return read && write ? {read: Number(read[1]), write: Number(write[1])} : null;
}
export function counterRate(current: number, previous: number | undefined, seconds: number): number | null {
    return previous === undefined || current < previous || seconds <= 0 ? null : (current - previous) / seconds;
}

export interface SocketCounter {pid: number; inode: string; sent: number; received: number;}
/** ss -tinpeHO: one socket per line, counters cover TCP payload, not UDP. */
export function tcpCounters(output: string): SocketCounter[] {
    const result: SocketCounter[] = [];
    for (const line of output.split('\n')) {
        const inode = /\bino:(\d+)/.exec(line)?.[1];
        if (!inode) continue;
        const sent = /\bbytes_sent:(\d+)/.exec(line)?.[1] ?? /\bbytes_acked:(\d+)/.exec(line)?.[1];
        const received = /\bbytes_received:(\d+)/.exec(line)?.[1];
        if (sent === undefined && received === undefined) continue;
        for (const pid of new Set([...line.matchAll(/\bpid=(\d+)/g)].map(match => Number(match[1]))))
            result.push({pid, inode, sent: Number(sent ?? 0), received: Number(received ?? 0)});
    }
    return result;
}
