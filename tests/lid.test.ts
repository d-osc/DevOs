import {GLib} from '@dev-os/core';
import System from 'system';
import {LidStandby, internalOutputs, type LidSource} from '@dev-os/runtime/lid';
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => { resolve(); return GLib.SOURCE_REMOVE; }));
const loop = new GLib.MainLoop(null, false);
async function run() {
    assert(internalOutputs('eDP-1 on\nHDMI-A-1 on\nDP-1 off\nLVDS-1 off').join() === 'eDP-1,LVDS-1', 'Only internal panels are affected');
    let emit: (closed: boolean) => void = () => {};
    const source: LidSource = {watch(handler) { emit = handler; return () => log.push('stop'); }};
    const log: string[] = [];
    let ready: () => void = () => {};
    const lid = new LidStandby(done => { log.push('lock'); ready = () => done(true); return true; },
        message => { throw new Error(message); }, source, async on => { log.push(on ? 'on' : 'off'); });
    lid.start(); emit(false); await wait();
    assert(log.length === 0, 'An initially open lid must not lock at boot');
    emit(true); await wait();
    assert(log.join() === 'lock', 'Lock readiness precedes display off');
    ready(); await wait();
    assert(log.join() === 'lock,off', 'Closed lid turns panel off');
    emit(true); await wait();
    assert(log.length === 2, 'Repeated observations do not retrigger');
    emit(false); await wait(); ready(); await wait();
    assert(log.join() === 'lock,off,lock,on', 'Reopening restores secure clock before panel on');
    emit(true); await wait(); emit(false); ready(); await wait(); ready(); await wait();
    assert(log.slice(-3).join() === 'lock,lock,on', 'Rapid reopen skips obsolete off request');
    lid.destroy();
    assert(log.at(-1) === 'stop', 'Watcher is disposed');
    const errors: string[] = [];
    const failed = new LidStandby(done => { done(false); return true; }, message => errors.push(message),
        source, async () => { throw new Error('An unready locker must not blank the display'); });
    failed.start(); emit(true); await wait();
    assert(errors.length === 1 && errors[0].includes('did not become ready'), 'Failed readiness refuses display blanking');
    failed.destroy();
    print('PASS: lid locking, output power ordering, duplicate events and rapid transitions');
}
run().then(() => loop.quit()).catch(error => { printerr(String(error)); loop.quit(); System.exit(1); });
loop.run();
