// Opt-in: tests live audio changes and restores the original output in finally.
import {GLib} from '@dev-os/core';
import {LinuxAudio} from '../extensions/org.devos.settings/audio.js';
function assert(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
async function verify() {
    const backend = new LinuxAudio(), state = await backend.load();
    const output = state.outputs.find(output => output.name === state.defaultOutput) ?? state.outputs[0];
    assert(output, 'No audio output is available for the live test');
    try {
        await backend.volume('sink', output.id, 37);
        assert((await backend.load()).outputs.find(next => next.id === output.id)?.volume === 37, 'Output volume did not change');
        await backend.mute('sink', output.id, true);
        assert((await backend.load()).outputs.find(next => next.id === output.id)?.muted === true, 'Output mute did not change');
        await backend.select('sink', output.name);
        assert((await backend.load()).defaultOutput === output.name, 'Default output selection failed');
    } finally {await backend.volume('sink', output.id, output.volume); await backend.mute('sink', output.id, output.muted); if (state.defaultOutput) await backend.select('sink', state.defaultOutput); backend.destroy();}
    print('PASS: real PipeWire/Pulse output volume, mute and default selection; original state restored');
}
if (GLib.getenv('DEVOS_AUDIO_INTEGRATION') === '1') {const loop = new GLib.MainLoop(null, false); let failed: unknown; void verify().catch(reason => {failed = reason;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;}
else print('SKIP: opt-in real audio mutation test');
