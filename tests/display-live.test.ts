// Opt-in only: temporarily changes a real compositor's display scale.
import {GLib} from '@dev-os/core';
import {LinuxDisplays, modeId, type DisplayChange} from '../src/apps/org.devos.settings/displays.js';
const wait = (seconds: number) => new Promise<void>(resolve => GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
async function verify() {
    const backend = new LinuxDisplays();
    const outputs = await backend.load(), output = outputs.find(output => output.enabled);
    assert(output, 'No active output'); const mode = output.modes.find(mode => mode.current); assert(mode, 'No current mode');
    const original: DisplayChange = {name: output.name, mode: modeId(mode), scale: output.scale, transform: output.transform, ...output.position};
    const changed = {...original, scale: output.scale === 1 ? 1.25 : 1};
    try {
        await backend.preview(changed);
        assert((await backend.load()).find(next => next.name === output.name)?.scale === changed.scale, 'Preview did not change the real display');
        await backend.revert();
        assert((await backend.load()).find(next => next.name === output.name)?.scale === original.scale, 'Explicit revert failed');
        await backend.preview(changed); backend.keep(); await wait(1);
        assert((await backend.load()).find(next => next.name === output.name)?.scale === changed.scale, 'Keep did not retain the change');
        await backend.preview(original); backend.keep();
        await backend.preview(changed);
        // No UI timer or confirmation: the independent watchdog must restore it.
        await wait(32);
        assert((await backend.load()).find(next => next.name === output.name)?.scale === original.scale, 'Independent watchdog failed');
        await backend.revert();
        print('PASS: real compositor preview, Keep, Revert and independent watchdog rollback');
    } finally {await backend.revert(); backend.destroy();}
}
if (GLib.getenv('DEVOS_DISPLAY_INTEGRATION') === '1') {const loop = new GLib.MainLoop(null, false); let failed: unknown; void verify().catch(reason => {failed = reason;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;}
else print('SKIP: opt-in real display mutation test');
