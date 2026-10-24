import {GLib} from '@dev-os/core';
import System from 'system';
import {SleepGuard, LOCK_WAIT_MS, type SleepSource} from '@dev-os/runtime/sleep';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
const loop = new GLib.MainLoop(null, false);
const wait = (ms: number) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));

function fake(available = true) {
    const log: string[] = [];
    let handler: (sleeping: boolean) => void = () => {};
    const source: SleepSource = {
        watch(next) { handler = next; log.push('watch'); return () => { log.push('unwatch'); }; },
        inhibit: async () => { log.push('inhibit'); return available ? () => { log.push('release'); } : null; },
    };
    return {source, log, emit: (sleeping: boolean) => handler(sleeping)};
}

async function run() {
    // A delay lock is taken at start, held while locking, released once the lock is ready, and retaken on wake.
    let ready: () => void = () => {};
    let a = fake();
    let guard = new SleepGuard(done => { a.log.push('lock'); ready = done; }, a.source);
    guard.start(); await wait(20);
    assert(a.log.join() === 'watch,inhibit', `Lock is taken at start: ${a.log}`);
    a.emit(true);
    assert(a.log.join() === 'watch,inhibit,lock', `Lock screen starts before sleep and the delay lock is held: ${a.log}`);
    ready();
    assert(a.log.join() === 'watch,inhibit,lock,release', `Sleep is released once the lock is ready: ${a.log}`);
    ready();
    assert(a.log.filter(entry => entry === 'release').length === 1, 'Release happens once');
    a.emit(false); await wait(20);
    assert(a.log.slice(-1)[0] === 'inhibit', `Delay lock is retaken after waking: ${a.log}`);
    guard.destroy();
    assert(a.log.slice(-2).join() === 'unwatch,release' || a.log.slice(-2).join() === 'release,unwatch', `Destroy stops and releases: ${a.log}`);

    // If the lock screen never reports, sleep is released after the cap instead of hanging.
    a = fake();
    guard = new SleepGuard(() => { a.log.push('lock'); }, a.source);
    guard.start(); await wait(20); a.emit(true);
    assert(!a.log.includes('release'), 'Held while waiting');
    await wait(LOCK_WAIT_MS + 300);
    assert(a.log.includes('release'), 'Released after the wait cap');
    guard.destroy();

    // A throwing lock must not block sleep.
    a = fake();
    guard = new SleepGuard(() => { throw new Error('no swaylock'); }, a.source);
    guard.start(); await wait(20); a.emit(true);
    assert(a.log.includes('release'), 'Released when locking throws');
    guard.destroy();

    // Without logind there is no delay lock and sleeping still works.
    a = fake(false);
    guard = new SleepGuard(done => { done(); }, a.source);
    guard.start(); await wait(20); a.emit(true); a.emit(false); await wait(20);
    guard.destroy();
    print('PASS: lock-before-sleep ordering, wake re-arm, release cap, lock failure and missing logind');
}
run().then(() => loop.quit()).catch(error => { printerr(String(error)); loop.quit(); System.exit(1); });
loop.run();
