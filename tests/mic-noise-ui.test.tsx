import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Box, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {MicNoiseSettings} from '../extensions/org.devos.settings/mic-noise-view.js';
import {MicrophoneSettings} from '../extensions/org.devos.microphone/settings-view.js';
import {unsupportedMicNoise, type MicNoiseAction, type MicNoiseControls, type MicNoiseState, type NoiseMode} from '../extensions/org.devos.settings/mic-noise.js';
Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 170, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const sources = [{name: 'alsa_input.mic_array', title: 'Microphone Array (Qualcomm)'}, {name: 'alsa_input.usb_headset', title: 'USB Headset Mono'}];
/** In-memory stand-in for the helper: a mode switch makes that mode the active one. */
export function fakeControls(initial: Partial<MicNoiseState>, calls: string[]): MicNoiseControls & {state: MicNoiseState; fail?: string} {
    const controls = {
        state: {...unsupportedMicNoise, supported: true, sources, device: sources[0].name, noise: {available: true, reason: ''}, ...initial} as MicNoiseState, fail: undefined as string | undefined,
        async request(action: MicNoiseAction, ...args: string[]) {
            calls.push([action, ...args].join(':'));
            if (controls.fail) throw new Error(controls.fail);
            if (action === 'mode') controls.state = {...controls.state, mode: args[0] as NoiseMode, active: args[0] as NoiseMode, running: args[0] !== 'authentic'};
            if (action === 'device') controls.state = {...controls.state, device: args[0]};
            return controls.state;
        },
        destroy() {calls.push('destroy');}
    };
    return controls;
}
async function verify() {
    const window = new Gtk.OffscreenWindow(); window.name = 'mic'; window.set_size_request(900, 700); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    const text = (id: string) => find<Gtk.Label>(id)?.get_text() ?? '';
    const labels = () => widgets(window).filter((w): w is Gtk.Label => w instanceof Gtk.Label).map(l => l.get_text());
    const mode = (id: string) => find<Gtk.Button>(`mic-mode-${id}`);
    const selected = () => (['general', 'authentic', 'conference'] as const).filter(id => mode(id)?.get_style_context().has_class('power-mode-selected'));
    try {
        // Supported system: the MyASUS card text, real devices, radios drive the helper.
        const calls: string[] = [], controls = fakeControls({}, calls);
        root.render(<MicNoiseSettings controls={controls} />); window.show_all(); await wait();
        const all = labels();
        for (const expected of ['AI Noise-Canceling Microphone', 'Suppresses ambient noise and normalizes all individual voices', 'Choose your input device', 'General Noise Canceling', '360° Recording Mode',
            'Reduce ambient noise from your surroundings to capture the best tone and audio details from all around you.', 'Authentic Recording', 'Turn off AI noise-canceling functions.', 'Conference AI Noise Canceling', 'Multi-presenter Mode'])
            assert(all.includes(expected), `Shows "${expected}"`);
        assert(all.some(label => label.includes('does not tell speakers apart')), 'Multi-presenter Mode says honestly that it does not identify speakers');
        assert(text('mic-noise-note').includes('not a speech-separation model'), 'The backend is named honestly');
        const combo = find<Gtk.ComboBoxText>('mic-noise-device');
        assert(combo && combo.get_active_id() === 'alsa_input.mic_array' && combo.sensitive, 'The dropdown lists the PipeWire microphones with the current one selected');
        assert(selected().join() === 'authentic' && mode('general').sensitive && mode('conference').sensitive, 'Authentic Recording is the default; the noise modes are offered');
        mode('general').emit('clicked'); await wait();
        assert(calls.includes('mode:general') && selected().join() === 'general', 'Choosing 360° Recording Mode applies it');
        mode('conference').emit('clicked'); await wait();
        assert(calls.includes('mode:conference') && selected().join() === 'conference', 'Choosing Multi-presenter Mode applies it');
        find<Gtk.ComboBoxText>('mic-noise-device').set_active_id('alsa_input.usb_headset'); await wait();
        assert(calls.includes('device:alsa_input.usb_headset') && controls.state.device === 'alsa_input.usb_headset', 'Choosing another input device is saved');
        controls.fail = 'The noise canceling service could not start'; mode('authentic').emit('clicked'); await wait();
        assert(text('mic-noise-error').includes('could not start') && selected().join() === 'conference', 'Helper failures are visible and the selection snaps back');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        root.render(<Box />); await wait(); assert(calls.includes('destroy'), 'Closing the page releases the helper');

        // Plugin missing: modes are shown but unavailable, with the reason; Authentic stays selected even when a noise mode was saved.
        const reason = 'Noise canceling needs the WebRTC audio-processing plugin (pipewire-spa-plugins-aec-webrtc), which is not installed in this system.';
        const missing = fakeControls({mode: 'conference', noise: {available: false, reason}, warning: reason + ' The microphone is used without processing.'}, []);
        root.render(<MicNoiseSettings key="missing" controls={missing} />); await wait();
        assert(!mode('general').sensitive && !mode('conference').sensitive && mode('authentic').sensitive, 'Noise modes are disabled without the plugin');
        assert(selected().join() === 'authentic', 'Without the plugin the effective mode is Authentic Recording');
        assert(text('mic-noise-unavailable').includes('not available') && text('mic-noise-unavailable').includes('pipewire-spa-plugins-aec-webrtc') && !find('mic-noise-note'), 'The unavailable modes are explained');

        // No microphone / no audio server.
        const none = fakeControls({sources: [], device: ''}, []);
        root.render(<MicNoiseSettings key="none" controls={none} />); await wait();
        assert(!!find('mic-noise-no-device') && !find('mic-noise-device'), 'No microphone is shown as a message instead of an empty dropdown');
        const down = fakeControls({supported: false, reason: 'The audio server (PipeWire) is not running or pw-dump is not installed.', sources: [], noise: {available: false, reason: ''}}, []);
        root.render(<MicNoiseSettings key="down" controls={down} />); await wait();
        assert(['general', 'authentic', 'conference'].every(id => !mode(id).sensitive) && selected().length === 0, 'Without an audio server every mode is disabled and none selected');
        assert(text('mic-noise-unsupported').startsWith('Not available.') && !find('mic-noise-unavailable'), 'The missing audio server is explained');

        // The Microphone settings page shows the card.
        root.render(<MicrophoneSettings key="page" open={() => {}} controls={{async load() {return {inputs: [], outputs: [], applications: [], defaultInput: '', defaultOutput: ''};}, async volume() {}, async mute() {}, async select() {}, async route() {}, destroy() {}}} noise={fakeControls({}, [])} />); await wait();
        assert(!!find('mic-noise-card') && !!mode('conference'), 'The Microphone settings page offers the noise-canceling card');
    } finally {root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: microphone noise-canceling settings, device choice, modes, unavailable plugin and honest backend text');
