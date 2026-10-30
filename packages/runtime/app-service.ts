import {Gio, GLib, Listeners} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
import {AppChannel} from './app-channel.js';

type Pending = {resolve(value: any): void; reject(error: Error): void; clean(): void};
const reference = Symbol('service-object');
let singleton: AppService | undefined;

/** One data worker per UI process. No shell commands, passwords or data in argv. */
export class AppService {
    private process: Gio.Subprocess;
    private channel: AppChannel;
    private pending = new Map<number, Pending>();
    private events = new Map<number, (snapshot: any) => void>();
    private callbacks = new Map<number, (...args: any[]) => unknown>();
    private objectCallbacks = new Map<number, number[]>();
    private sequence = 0;
    private dead = false;
    constructor() {
        this.process = Gio.Subprocess.new(['gjs', '-m', `${ROOT}/dist/app-service-host.js`, GLib.getenv('DEV_OS_APP') || 'settings'],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        this.channel = new AppChannel(this.process.get_stdout_pipe()!, this.process.get_stdin_pipe()!, frame => {
            if (frame.event === 'state') {this.events.get(frame.object)?.(this.decode(frame.value)); return;}
            if (frame.event === 'callback') {
                Promise.resolve().then(() => {
                    const callback = this.callbacks.get(frame.callback);
                    if (!callback) throw new Error('App view closed.');
                    return callback(...this.decode(frame.args));
                }).then(value => this.channel.send({callbackReply: frame.id, value: this.encode(value)}),
                    error => this.channel.send({callbackReply: frame.id, error: String(error)})).catch(() => {});
                return;
            }
            const pending = this.pending.get(frame.id); if (!pending) return;
            this.pending.delete(frame.id); pending.clean();
            if (frame.error) pending.reject(new Error(frame.error)); else pending.resolve(this.decode(frame.value));
        }, error => this.fail(error));
        this.process.wait_async(null, (_child, result) => {
            try {this.process.wait_finish(result);} catch {}
            this.fail(new Error('App data service stopped. Restart the app process or session to reconnect.'));
        });
    }
    private fail(error: Error) {
        if (this.dead) return; this.dead = true; this.channel.close();
        for (const request of this.pending.values()) {request.clean(); request.reject(error);}
        this.pending.clear();
        for (const listener of this.events.values()) listener({error: error.message});
    }
    encode(value: any, allocated: number[] = []): any {
        if (value === undefined) return {$undefined: true};
        if (typeof value === 'function') {const id = ++this.sequence; this.callbacks.set(id, value); allocated.push(id); return {$callback: id};}
        if (value?.[reference]) return {$object: value[reference]};
        if (value instanceof Gio.Cancellable) return {$cancel: true};
        if (value instanceof Gio.Icon) return {$icon: value.to_string()};
        if (Array.isArray(value)) return value.map(item => this.encode(item, allocated));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.encode(item, allocated)]));
        return value;
    }
    private decode(value: any): any {
        if (value?.$undefined) return undefined;
        if (value?.$cancel) return new Gio.Cancellable();
        if (value?.$icon) return Gio.Icon.new_for_string(value.$icon);
        if (Array.isArray(value)) return value.map(item => this.decode(item));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.decode(item)]));
        return value;
    }
    request(op: string, args: unknown[] = [], object?: number): Promise<any> {
        if (this.dead) return Promise.reject(new Error('App data service is unavailable. Restart the app process or session.'));
        const id = ++this.sequence, allocated: number[] = [];
        let encoded: unknown;
        try {encoded = this.encode(args, allocated);} catch (error) {return Promise.reject(error);}
        const clean = () => {for (const callback of allocated) this.callbacks.delete(callback);};
        if (op === 'create') this.objectCallbacks.set(Number(args[2]), allocated);
        if (op === 'dispose' && object !== undefined) {
            for (const callback of this.objectCallbacks.get(object) ?? []) this.callbacks.delete(callback);
            this.objectCallbacks.delete(object);
        }
        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject, clean: op === 'create' ? () => {} : clean});
            this.channel.send({id, op, object, args: encoded}).catch(error => {this.pending.delete(id); clean(); reject(error);});
        }).catch(error => {if (op === 'create') {clean(); this.objectCallbacks.delete(Number(args[2]));} throw error;});
    }

    allocate() {return ++this.sequence;}
    watch(id: number, listener: (snapshot: any) => void) {this.events.set(id, listener);}
    unwatch(id: number) {this.events.delete(id);}
    destroy() {
        this.fail(new Error('App UI closed.')); this.callbacks.clear(); this.objectCallbacks.clear(); this.events.clear();
        // EOF lets the service dispose models, rollback previews and stop children.
        try {this.process.get_stdin_pipe()?.close(null);} catch {}
    }
}
export function appService() {return singleton ??= new AppService();}
export function closeAppService() {singleton?.destroy(); singleton = undefined;}

/** Typed facades contain view snapshots only; implementations live in the service. */
export function serviceClass<T>(name: string, defaults: Record<string, unknown>, voidMethods: string[] = [], viewMethods: Record<string, (snapshot: any, ...args: any[]) => unknown> = {}): T {
    return class {
        constructor(...args: unknown[]) {
            const service = appService(), listeners = new Listeners();
            let snapshot: Record<string | symbol, any> = {...defaults}, id = service.allocate(), disposed = false, editing = 0;
            let latest: any;
            const update = (value: any) => {if (!disposed) {
                latest = value;
                const local = editing ? {content: snapshot.content, dirty: snapshot.dirty} : {};
                snapshot = {...snapshot, ...value, ...(snapshot.state && value.state ? {state: {...snapshot.state, ...value.state}} : {}), ...local};
                if (value.error && snapshot.state) snapshot.state = {...snapshot.state, error: value.error, loading: false, busy: false};
                listeners.emit();
            }};
            const ready = service.request('create', [name, args, id]).then(result => {
                id = result.id; update(result.snapshot);
                if (disposed) void service.request('dispose', [], id).catch(() => {});
                else service.watch(id, update);
                return id;
            });
            const failed = (error: unknown) => update({error: String(error)});
            void ready.catch(failed);
            return new Proxy(this, {get: (_target, property) => {
                if (property === reference) return id;
                if (property === 'then') return undefined;
                if (property === 'subscribe') return (listener: () => void) => listeners.subscribe(listener);
                if (property === 'dispose' || property === 'destroy') return () => {
                    if (disposed) return; disposed = true; listeners.clear();
                    if (id) {service.unwatch(id); void service.request('dispose', [], id).catch(() => {});}
                };
                if (typeof property === 'string' && viewMethods[property]) return (...args: any[]) => viewMethods[property](snapshot, ...args);
                if (property in snapshot) return snapshot[property];
                if (typeof property !== 'string') return undefined;
                return (...values: unknown[]) => {
                    if (name === 'files/search.FileSearch' && property === 'setQuery') {snapshot.state = {...snapshot.state, query: values[0], pending: true}; listeners.emit();}
                    if (name === 'files/search.FileSearch' && property === 'start') {snapshot.state = {...snapshot.state, root: values[0], query: '', results: [], matches: 0, indexed: 0, scanning: true}; listeners.emit();}
                    if (name === 'files/model.FileBrowser' && property === 'select') {snapshot.state = {...snapshot.state, selected: values[0]}; listeners.emit();}
                    if (name === 'editor/document.EditorDocument' && property === 'reportError') {snapshot.error = String(values[0]); listeners.emit();}
                    const edit = name === 'editor/document.EditorDocument' && property === 'edit';
                    if (edit) {editing++; snapshot.content = values[0]; snapshot.dirty = true; listeners.emit();}
                    const call = ready.then(() => {
                        if (disposed) {
                            if (name === 'files/model.FileBrowser' || name === 'editor/document.EditorDocument') return false;
                            if (name === 'files/search.FileSearch') return;
                            throw new Error('App view closed.');
                        }
                        return service.request('call', [property, values], id);
                    }).catch(error => {
                        if (['files/model.FileBrowser', 'editor/document.EditorDocument', 'files/search.FileSearch'].includes(name)) {failed(error); return name === 'files/search.FileSearch' ? undefined : false;}
                        throw error;
                    }).finally(() => {if (edit) {editing--; if (!editing && latest) update(latest);}});
                    if (voidMethods.includes(property)) {void call.catch(failed); return;}
                    return call;
                };
            }});
        }
    } as T;
}
