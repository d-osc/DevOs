import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';

export interface InstallDisk {name: string; path: string; size: number; model: string; transport: string; removable: boolean; contents: string;}
export interface InstallOptions {disk: InstallDisk; username: string; hostname: string; password: string;}
export type InstallEvent = {kind: 'step'; step: number; total: number; message: string} | {kind: 'done'; message: string} | {kind: 'error'; message: string};
export interface InstallerControls {
    /** True when running from the Live USB session, the only place the installer may erase a disk. */
    available(): boolean;
    disks(): Promise<InstallDisk[]>;
    install(options: InstallOptions, report: (event: InstallEvent) => void): Promise<void>;
    reboot(): void;
    destroy(): void;
}

export const USERNAME = /^[a-z][a-z0-9_-]{0,31}$/;
export const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Parses one line of `dev-os-install run` output; anything else (tool chatter) is ignored. */
export function parseInstallLine(line: string): InstallEvent | null {
    const step = /^STEP (\d+)\/(\d+) (.+)$/.exec(line);
    if (step) return {kind: 'step', step: Number(step[1]), total: Number(step[2]), message: step[3]!};
    if (line.startsWith('ERROR ')) return {kind: 'error', message: line.slice(6)};
    if (line.startsWith('DONE')) return {kind: 'done', message: line.slice(4).trim()};
    return null;
}

export class Installer implements InstallerControls {
    private processes = new Set<Gio.Subprocess>();
    private helper(): string {
        const local = `${ROOT}/bin/dev-os-install`;
        return GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : (GLib.find_program_in_path('dev-os-install') ?? local);
    }
    available() { return GLib.file_test('/run/devos-live/root-session-enabled', GLib.FileTest.EXISTS); }
    disks(): Promise<InstallDisk[]> {
        return new Promise((resolve, reject) => {
            let child: Gio.Subprocess;
            try { child = Gio.Subprocess.new(['sh', this.helper(), 'disks', '--json'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); }
            catch (error) { reject(error); return; }
            this.processes.add(child);
            child.communicate_utf8_async(null, null, (_source, result) => {
                this.processes.delete(child);
                try {
                    const [, stdout, stderr] = child.communicate_utf8_finish(result);
                    if (!child.get_successful()) throw new Error((stdout?.trim() || stderr?.trim()) || 'Could not list disks.');
                    resolve(JSON.parse(stdout || '[]') as InstallDisk[]);
                } catch (error) { reject(error); }
            });
        });
    }
    install(options: InstallOptions, report: (event: InstallEvent) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            let child: Gio.Subprocess;
            const {disk} = options;
            try {
                child = Gio.Subprocess.new(['sh', this.helper(), 'run', '--disk', disk.path, '--confirm-erase', disk.path, '--confirm-size', String(disk.size),
                    '--username', options.username, '--hostname', options.hostname, '--password-stdin'],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
            } catch (error) { reject(error); return; }
            this.processes.add(child);
            // The password travels only through the helper's standard input, never its arguments or environment.
            const input = child.get_stdin_pipe()!;
            input.write_all(new TextEncoder().encode(`${options.password}\n`), null);
            input.close(null);
            const output = new Gio.DataInputStream({base_stream: child.get_stdout_pipe()!});
            let finished = false;
            const tail: string[] = [];
            const read = () => output.read_line_async(GLib.PRIORITY_DEFAULT, null, (_source, result) => {
                try {
                    const [line] = output.read_line_finish_utf8(result);
                    if (line === null) {
                        if (finished) { this.processes.delete(child); resolve(); return; }
                        finished = true;
                        child.wait_async(null, (_process, waited) => {
                            let reason = '';
                            try {
                                child.wait_finish(waited);
                                reason = child.get_if_signaled() ? ` (stopped by signal ${child.get_term_sig()})` : ` (exit status ${child.get_exit_status()})`;
                            } catch { /* The status is only extra detail. */ }
                            const last = tail.length ? ` Last output: ${tail.join(' / ')}` : '';
                            report({kind: 'error', message: `The installer stopped unexpectedly${reason}.${last} Log: /var/log/devos-install.log`});
                            this.processes.delete(child); resolve();
                        });
                        return;
                    }
                    const event = parseInstallLine(line);
                    if (!event && line.trim()) { tail.push(line.trim().slice(0, 160)); if (tail.length > 3) tail.shift(); }
                    if (event) { if (event.kind !== 'step') finished = true; report(event); }
                    read();
                } catch (error) { this.processes.delete(child); reject(error); }
            });
            read();
        });
    }
    reboot() {
        try { Gio.Subprocess.new(['systemctl', 'reboot'], Gio.SubprocessFlags.NONE); } catch { /* The user can restart from the power button. */ }
    }
    destroy() { for (const child of this.processes) child.force_exit(); this.processes.clear(); }
}
