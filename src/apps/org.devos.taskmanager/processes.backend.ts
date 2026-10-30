import {Gio, GLib} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
import {processIdentity, swapBytes, diskCounters, counterRate, tcpCounters, type SocketCounter} from './process-metrics.js';
import {gpuClient, sampleGpu, type GpuClient} from './gpu-metrics.js';
export type {ProcessInfo, ProcessState, ProcessControls} from './process-types.js';
import type {ProcessInfo, ProcessState, ProcessControls} from './process-types.js';
export class Processes implements ProcessControls {
    private process: Gio.Subprocess;
    private input: Gio.DataInputStream;
    private output: Gio.OutputStream;
    private pending: Promise<unknown> = Promise.resolve();
    private identities = new Map<string, ReturnType<typeof processIdentity>>();
    private disks = new Map<string, {read: number; write: number}>();
    private sockets = new Map<string, SocketCounter>();
    private gpuClients = new Map<string, Map<string, GpuClient>>();
    private lastTime = 0;
    private networkReady = false;
    private networkProcess?: Gio.Subprocess;
    private destroyed = false;
    private sampling: Promise<unknown> = Promise.resolve();
    private read(path: string): string | null {
        try {return new TextDecoder().decode(GLib.file_get_contents(path)[1]);} catch {return null;}
    }
    private gpu(folder: string): GpuClient[] {
        const clients: GpuClient[] = [];
        let files: Gio.FileEnumerator | undefined;
        try {
            files = Gio.File.new_for_path(`${folder}/fdinfo`).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            for (let file = files.next_file(null); file; file = files.next_file(null)) {
                try {
                    const target = GLib.file_read_link(`${folder}/fd/${file.get_name()}`);
                    if (!target.startsWith('/dev/dri/')) continue;
                    const client = gpuClient(this.read(`${folder}/fdinfo/${file.get_name()}`) || '');
                    if (client) clients.push(client);
                } catch { /* A process can close its descriptor during sampling. */ }
            }
        } catch { /* Missing counters or permissions mean unavailable. */ }
        finally {files?.close(null);}
        return clients;
    }
    private async network(): Promise<SocketCounter[] | null> {
        const ss = GLib.find_program_in_path('ss');
        if (!ss || this.destroyed) return null;
        let child: Gio.Subprocess;
        try {child = this.networkProcess = Gio.Subprocess.new([ss, '-tinpeHO'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);} catch {return null;}
        const cancel = new Gio.Cancellable();
        let timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {timeout = 0; child.force_exit(); cancel.cancel(); return GLib.SOURCE_REMOVE;});
        try {
            const output = await new Promise<string>((resolve, reject) => child.communicate_utf8_async(null, cancel, (_source, result) => {
                try {const [, stdout] = child.communicate_utf8_finish(result); if (!child.get_successful()) throw new Error('TCP counters unavailable'); resolve(stdout || '');} catch (error) {reject(error);}
            }));
            return tcpCounters(output);
        } catch {return null;}
        finally {if (timeout) GLib.source_remove(timeout); if (this.networkProcess === child) this.networkProcess = undefined;}
    }
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
    load(): Promise<ProcessState> {
        const next = this.sampling.then(async () => {
            const state = await this.request({action: 'get'}) as ProcessState;
            const counters = await this.network();
            const now = GLib.get_monotonic_time(), seconds = (now - this.lastTime) / 1_000_000;
            const uid = Number(/^Uid:\s+(\d+)/m.exec(this.read('/proc/self/status') || '')?.[1] ?? -1);
            const identities = new Map<string, ReturnType<typeof processIdentity>>(), disks = new Map<string, {read: number; write: number}>(), sockets = new Map<string, SocketCounter>();
            const byPid = new Map(state.processes.map(item => [item.pid, item]));
            const gpuClients = new Map<string, Map<string, GpuClient>>();
            for (const item of state.processes) {
                const key = `${item.pid}:${item.start}`, folder = `/proc/${item.pid}`;
                const args = this.read(`${folder}/cmdline`)?.split('\0').filter(Boolean) || [];
                const identity = args.length ? processIdentity(args, item.name, ROOT) : this.identities.get(key) || processIdentity([], item.name);
                identities.set(key, identity); Object.assign(item, identity);
                const gpu = sampleGpu(this.gpu(folder), this.gpuClients.get(key) || new Map(), seconds);
                item.gpu = gpu.usage; item.gpuMemory = gpu.memory;
                if (gpu.clients.size) gpuClients.set(key, gpu.clients);
                item.swap = swapBytes(this.read(`${folder}/status`) || '');
                const disk = diskCounters(this.read(`${folder}/io`) || ''), previous = this.disks.get(key);
                item.diskRead = disk ? counterRate(disk.read, previous?.read, seconds) : null;
                item.diskWrite = disk ? counterRate(disk.write, previous?.write, seconds) : null;
                if (disk) disks.set(key, disk);
                let readable = false;
                if (item.uid === uid) {
                    try {Gio.File.new_for_path(`${folder}/fd`).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null).close(null); readable = true;} catch {}
                }
                item.networkReceive = item.networkSend = counters && this.networkReady && this.identities.has(key) && readable ? 0 : null;
            }
            for (const socket of counters || []) {
                const item = byPid.get(socket.pid);
                if (!item) continue;
                const key = `${item.pid}:${item.start}:${socket.inode}`, previous = this.sockets.get(key);
                sockets.set(key, socket);
                // A new connection belonging to an existing process started since
                // the last sample. A newly seen process needs its own baseline.
                const existing = this.identities.has(`${item.pid}:${item.start}`);
                if (item.networkReceive !== null && existing) {
                    item.networkReceive! += counterRate(socket.received, previous?.received ?? 0, seconds) ?? 0;
                    item.networkSend! += counterRate(socket.sent, previous?.sent ?? 0, seconds) ?? 0;
                }
            }
            this.identities = identities; this.disks = disks; this.sockets = sockets;
            this.gpuClients = gpuClients;
            this.lastTime = now; this.networkReady = counters !== null;
            return state;
        });
        this.sampling = next.catch(() => undefined);
        return next;
    }
    async stop(item: ProcessInfo, force: boolean) {await this.request({action: 'stop', pid: item.pid, start: item.start, force});}
    destroy() {this.destroyed = true; this.networkProcess?.force_exit(); this.process.force_exit(); this.identities.clear(); this.disks.clear(); this.sockets.clear(); this.gpuClients.clear();}
}
