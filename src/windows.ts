import {Gio, GLib} from './gtk.js';
import {ROOT} from './config.js';

export interface DesktopWindow {id: number; title: string; appId: string; active: boolean; minimized: boolean;}
export interface WindowControls {
    readonly state: readonly DesktopWindow[];
    subscribe(listener: () => void): () => void;
    activate(id: number): void;
    toggle(id: number): void;
}

// The base owns the Wayland connection; extensions consume snapshots and actions.
export class Windows implements WindowControls {
    state: readonly DesktopWindow[] = [];
    private entries = new Map<number, DesktopWindow>();
    private listeners = new Set<() => void>();
    private cancel = new Gio.Cancellable();
    private process?: Gio.Subprocess;
    private input?: Gio.OutputStream;
    private output?: Gio.DataInputStream;
    private pending = 0;
    private disposed = false;
    private queue: string[] = [];
    private writing = false;
    constructor() {
        const helper = [`${ROOT}/build/native/dev-os-window-tracker`, `${ROOT}/native/dev-os-window-tracker`]
            .find(path => GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE)) ?? GLib.find_program_in_path('dev-os-window-tracker');
        if (!helper) { printerr('Dev OS: build the window tracker with tools/bootstrap-window-tracker.sh'); return; }
        try {
            this.process = Gio.Subprocess.new([helper], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
            this.input = this.process.get_stdin_pipe()!;
            this.output = new Gio.DataInputStream({base_stream: this.process.get_stdout_pipe()!});
            this.read();
        } catch (error) { printerr(`Dev OS window tracker: ${String(error)}`); }
    }
    subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    private publish() {
        if (this.disposed || this.pending) return;
        this.pending = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.pending = 0; this.state = [...this.entries.values()];
            for (const listener of this.listeners) listener();
            return GLib.SOURCE_REMOVE;
        });
    }
    private read() {
        this.output!.read_line_async(GLib.PRIORITY_DEFAULT, this.cancel, (_source, result) => {
            if (this.disposed) return;
            try {
                const [line] = this.output!.read_line_finish_utf8(result);
                if (line === null) { this.entries.clear(); this.publish(); this.input = undefined; return; }
                const event = JSON.parse(line) as Record<string, unknown>;
                if (event.type === 'window' && typeof event.id === 'number' && Number.isSafeInteger(event.id) && event.id > 0 &&
                    typeof event.title === 'string' && typeof event.appId === 'string' && typeof event.active === 'boolean' && typeof event.minimized === 'boolean') {
                    this.entries.set(event.id, {id: event.id, title: event.title, appId: event.appId, active: event.active, minimized: event.minimized});
                    this.publish();
                } else if (event.type === 'closed' && typeof event.id === 'number') { this.entries.delete(event.id); this.publish(); }
                else if (event.type === 'ready') print('Dev OS window tracker ready');
                this.read();
            } catch (error) {
                if (!this.disposed) { this.entries.clear(); this.publish(); this.input = undefined; printerr(`Dev OS window tracker: ${String(error)}`); }
            }
        });
    }
    private send(action: 'activate' | 'minimize', id: number) {
        if (this.disposed || !this.input || !this.entries.has(id)) return;
        this.queue.push(`${action} ${id}\n`); this.write();
    }
    private write() {
        if (this.disposed || this.writing || !this.input || !this.queue.length) return;
        this.writing = true;
        this.input.write_all_async(new TextEncoder().encode(this.queue.shift()!), GLib.PRIORITY_DEFAULT, this.cancel, (stream, result) => {
            this.writing = false;
            if (this.disposed) return;
            try { (stream as Gio.OutputStream).write_all_finish(result); this.write(); }
            catch (error) { this.queue = []; printerr(`Dev OS window action: ${String(error)}`); }
        });
    }
    activate(id: number) { this.send('activate', id); }
    toggle(id: number) {
        const window = this.entries.get(id);
        if (window) this.send(window.active && !window.minimized ? 'minimize' : 'activate', id);
    }
    destroy() {
        if (this.disposed) return; this.disposed = true;
        this.cancel.cancel(); if (this.pending) GLib.source_remove(this.pending);
        this.process?.force_exit(); this.listeners.clear(); this.entries.clear(); this.queue = []; this.state = [];
    }
}

export function windowGroup(window: DesktopWindow) {
    if (/^Dev OS Terminal(?:$| ·)/.test(window.title) || /^(foot|org\.gnome\.Terminal|org\.wezfurlong\.wezterm)$/i.test(window.appId)) return 'terminal';
    if (/^Dev OS Files(?:$| ·)/.test(window.title) || /^(thunar|org\.gnome\.Nautilus)$/i.test(window.appId)) return 'files';
    if (/^Dev OS Settings(?:$| ·)/.test(window.title)) return 'settings';
    if (/^Dev OS Editor(?:$| ·)/.test(window.title)) return 'dev-os-editor';
    return window.appId || `window-${window.id}`;
}
