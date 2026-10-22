import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export interface ProcessInfo {pid: number; name: string; user: string; uid: number; state: string; cpu: number; memory: number; start: string; canStop: boolean;}
export interface ProcessState {processes: ProcessInfo[]; cpu: number; memoryTotal: number; memoryUsed: number; swapTotal: number; swapUsed: number; cores: number; uptime: number;}
export interface ProcessControls {load(): Promise<ProcessState>; stop(item: ProcessInfo, force: boolean): Promise<void>; destroy(): void;}
export class Processes implements ProcessControls {
    private process: Gio.Subprocess;
    private input: Gio.DataInputStream;
    private output: Gio.OutputStream;
    private pending: Promise<unknown> = Promise.resolve();
    constructor() {
        const local = `${ROOT}/bin/dev-os-processes`;
        const helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-processes');
        if (!helper) throw new Error('Process monitor is not installed.');
        this.process = Gio.Subprocess.new(['d', helper], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        this.input = new Gio.DataInputStream({base_stream: this.process.get_stdout_pipe()!}); this.output = this.process.get_stdin_pipe()!;
    }
    private request(data: object): Promise<unknown> {
        const next = this.pending.then(() => new Promise((resolve, reject) => {
            try {this.output.write_all(new TextEncoder().encode(JSON.stringify(data) + '\n'), null); this.input.read_line_async(GLib.PRIORITY_DEFAULT, null, (_source, result) => {
                try {const [line] = this.input.read_line_finish_utf8(result); const response = JSON.parse(line || '{}'); if (!response.ok) throw new Error(response.error || 'Process monitor disconnected.'); resolve(response);} catch (error) {reject(error);}
            });} catch (error) {reject(error);}
        })); this.pending = next.catch(() => undefined); return next;
    }
    async load() {return await this.request({action: 'get'}) as ProcessState;}
    async stop(item: ProcessInfo, force: boolean) {await this.request({action: 'stop', pid: item.pid, start: item.start, force});}
    destroy() {this.process.force_exit();}
}
