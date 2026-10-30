import {Gio, GLib} from '@dev-os/core/base';
import {Processes} from '../src/apps/org.devos.taskmanager/processes.backend.js';

const wait = (ms: number) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const fixture = `import socket, tempfile, os, time
listener = socket.socket()
listener.bind(('127.0.0.1', 0))
listener.listen()
client = socket.socket()
client.connect(listener.getsockname())
server, _ = listener.accept()
file = tempfile.TemporaryFile()
payload = b'x' * 65536
print('ready', flush=True)
while True:
    client.sendall(payload)
    received = 0
    while received < len(payload): received += len(server.recv(len(payload) - received))
    file.seek(0)
    file.write(payload)
    file.flush()
    os.fsync(file.fileno())
    time.sleep(.03)
`;
const loop = new GLib.MainLoop(null, false);
let failure: unknown;
async function run() {
    const child = Gio.Subprocess.new(['python3', '-c', fixture], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const monitor = new Processes();
    try {
        const ready = new Gio.DataInputStream({base_stream: child.get_stdout_pipe()!});
        await new Promise<void>((resolve, reject) => ready.read_line_async(GLib.PRIORITY_DEFAULT, null, (_source, result) => {
            try {if (ready.read_line_finish_utf8(result)[0] !== 'ready') throw new Error('Fixture did not start'); resolve();} catch (error) {reject(error);}
        }));
        const pid = Number(child.get_identifier());
        const first = (await monitor.load()).processes.find(item => item.pid === pid)!;
        if (!first || first.diskWrite !== null || first.networkReceive !== null) throw new Error('First sample must warm up cumulative rates');
        await wait(300);
        const second = (await monitor.load()).processes.find(item => item.pid === pid)!;
        const hasDiskCounters = GLib.file_test(`/proc/${pid}/io`, GLib.FileTest.EXISTS);
        if (!second || second.swap === null || hasDiskCounters && !(second.diskWrite! > 0) || !(second.networkReceive! > 0) || !(second.networkSend! > 0)) throw new Error(`Missing real process metrics: ${JSON.stringify(second)}`);
        if (!hasDiskCounters && (second.diskRead !== null || second.diskWrite !== null)) throw new Error('Unsupported kernel disk accounting must remain unavailable');
        if (!second.command?.includes('python3')) throw new Error('Original executable must remain searchable');
        if (second.gpu !== null || second.gpuMemory !== null) throw new Error('A process without DRM counters must show unknown GPU usage instead of zero');
        print(`PASS: real per-process TCP traffic and ${hasDiskCounters ? 'disk traffic' : 'unsupported disk accounting fallback'}: ${JSON.stringify({swap: second.swap, diskWrite: second.diskWrite, receive: second.networkReceive, send: second.networkSend})}`);
        // Missing TCP tooling must not break process, memory or disk sampling.
        const originalPath = GLib.getenv('PATH') || '';
        GLib.setenv('PATH', '/nonexistent-process-metrics-test', true);
        try {
            const unavailable = (await monitor.load()).processes.find(item => item.pid === pid)!;
            if (!unavailable || unavailable.networkReceive !== null || unavailable.networkSend !== null || hasDiskCounters && unavailable.diskWrite == null) throw new Error('Missing ss must degrade to unknown TCP counters');
        } finally {GLib.setenv('PATH', originalPath, true);}
    } finally {monitor.destroy(); child.force_exit();}
}
void run().catch(error => {failure = error;}).finally(() => loop.quit());
loop.run();
if (failure) throw failure;
