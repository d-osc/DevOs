import {Gio, GLib} from '@dev-os/core/base';
import System from 'system';
import {AppChannel} from '@dev-os/runtime/app-channel';
import {projectAppView} from './app-view-data.js';
import {serviceControllers} from './app-service-registry.js';

const loop = new GLib.MainLoop(null, false);
const objects = new Map<number, {value: any; properties: string[]; sent: Map<string, any>; editing?: boolean; unsubscribe?: () => void}>();
const callbacks = new Map<number, {resolve(value: any): void; reject(error: Error): void}>();
let callbackId = 0, closing = false;
let creations: Promise<unknown> = Promise.resolve();
function encode(value: any): any {
    if (value === undefined) return {$undefined: true};
    if (value instanceof Gio.Icon) return {$icon: value.to_string()};
    if (value instanceof Gio.Cancellable) return {$cancel: true};
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
    return value;
}
function decode(value: any): any {
    if (value?.$undefined) return undefined;
    if (value?.$object) {
        const object = objects.get(value.$object); if (!object) throw new Error('Unknown app service object.');
        return object.value;
    }
    if (value?.$callback) return (...args: unknown[]) => {const promise = new Promise((resolve, reject) => {
        const id = ++callbackId; callbacks.set(id, {resolve, reject});
        void channel.send({event: 'callback', id, callback: value.$callback, args: encode(args)}).catch(reject);
    }); void promise.catch(() => {}); return promise;};
    if (value?.$cancel) return new Gio.Cancellable();
    if (value?.$icon) return Gio.Icon.new_for_string(value.$icon);
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
    return value;
}
function snapshot(object: {value: any; properties: string[]; sent: Map<string, any>; editing?: boolean}) {
    const changed: Record<string, unknown> = {};
    for (const key of object.properties) {
        const value = object.value[key], previous = object.sent.get(key), first = !object.sent.has(key);
        object.sent.set(key, value);
        if (key === 'content' && object.editing) continue; // The UI originated this text; never echo it back per keystroke.
        if (key === 'state' && value && typeof value === 'object' && !first) {
            const fields = Object.fromEntries(Object.entries(value).filter(([name, item]) => !Object.is(previous?.[name], item)));
            if (Object.keys(fields).length) changed[key] = encode(fields);
        } else if (first || (value && typeof value === 'object') || !Object.is(previous, value)) changed[key] = encode(value);
    }
    return changed;
}
function dispose(id: number) {
    const object = objects.get(id); if (!object) return;
    objects.delete(id); object.unsubscribe?.();
    (object.value.dispose ?? object.value.destroy)?.call(object.value);
}
function shutdown() {
    if (closing) return; closing = true;
    for (const id of [...objects.keys()].reverse()) {try {dispose(id);} catch (error) {printerr(String(error));}}
    for (const callback of callbacks.values()) callback.reject(new Error('App UI disconnected.'));
    callbacks.clear();
    // Let async cleanup (display rollback, capture teardown) make progress before exit.
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {loop.quit(); return GLib.SOURCE_REMOVE;});
}
const channel = new AppChannel(Gio.File.new_for_path('/proc/self/fd/0').read(null),
    Gio.File.new_for_path('/proc/self/fd/1').append_to(Gio.FileCreateFlags.NONE, null), frame => {
        if (frame.callbackReply) {
            const pending = callbacks.get(frame.callbackReply); callbacks.delete(frame.callbackReply);
            if (frame.error) pending?.reject(new Error(frame.error)); else pending?.resolve(decode(frame.value));
            return;
        }
        void execute(frame).then(value => channel.send({id: frame.id, value: encode(value)}),
            error => channel.send({id: frame.id, error: String(error)})).catch(() => {});
    }, shutdown);
async function execute(frame: any) {
    if (closing) throw new Error('App service is closing.');
    if (frame.op === 'create') {
        const creation = creations.then(async () => {
            const [name, args, id] = frame.args;
            const definition = serviceControllers[name];
            if (closing || !definition || !Number.isSafeInteger(id) || objects.has(id)) throw new Error('Invalid app controller.');
            const object = {value: await definition.create(decode(args)), properties: definition.properties, sent: new Map<string, any>(), editing: false, unsubscribe: undefined as (() => void) | undefined};
            objects.set(id, object);
            if (closing) {dispose(id); throw new Error('App UI disconnected.');}
            object.unsubscribe = object.value.subscribe?.(() => {
                void channel.send({event: 'state', object: id, value: snapshot(object)}).catch(() => {});
            });
            return {id, snapshot: snapshot(object)};
        });
        creations = creation.catch(() => {});
        return creation;
    }
    if (frame.op === 'dispose') {dispose(frame.object); return null;}
    if (frame.op === 'project') {await creations; const [kind, input] = decode(frame.args); return projectAppView(kind, input);}
    if (frame.op === 'ping') return {pid: new Gio.Credentials().get_unix_pid(), role: ARGV[0]};
    await creations;
    const object = objects.get(frame.object);
    if (frame.op !== 'call' || !object) throw new Error('Unknown service request.');
    const [method, args] = frame.args;
    if (['constructor', '__proto__', 'prototype'].includes(method) || typeof object.value[method] !== 'function') throw new Error('Invalid service operation.');
    try {
        object.editing = method === 'edit' && object.properties.includes('content');
        const result = Promise.resolve(object.value[method](...decode(args)));
        // Observe immediate backend failures before yielding to the state write.
        void result.catch(() => {});
        await channel.send({event: 'state', object: frame.object, value: snapshot(object)});
        return await result;
    }
    finally {object.editing = false; if (objects.has(frame.object)) await channel.send({event: 'state', object: frame.object, value: snapshot(object)});}
}
loop.run();
System.exit(0);
