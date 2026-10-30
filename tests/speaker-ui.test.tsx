import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Box, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {SystemSettings} from '../src/apps/org.devos.settings/system-view.js';
import {SpeakerSettings} from '../src/apps/org.devos.settings/speaker-view.js';
import {unsupportedSpeaker, type CustomSlot, type SoundMode, type SpeakerAction, type SpeakerControls, type SpeakerState} from '../src/apps/org.devos.settings/speaker.js';
import type {AudioControls} from '../src/apps/org.devos.settings/audio.js';
Gtk.init(null);
const wait = (ms = 170) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const speakers = [{name: 'alsa_output.speakers', title: 'Speakers (Qualcomm(R) Aqstic(TM))'}, {name: 'alsa_output.hdmi', title: 'HDMI Display'}];
/** In-memory stand-in for the helper. */
function fakeControls(initial: Partial<SpeakerState>, calls: string[]): SpeakerControls & {state: SpeakerState; fail?: string} {
    const controls = {
        state: {...unsupportedSpeaker, supported: true, speakers, device: speakers[0].name, filters: {available: true, reason: ''}, ...initial} as SpeakerState, fail: undefined as string | undefined,
        async request(action: SpeakerAction, ...args: string[]) {
            calls.push([action, ...args].join(':'));
            if (controls.fail) throw new Error(controls.fail);
            const s = controls.state;
            if (action === 'voice') controls.state = {...s, voice: args[0] === 'on'};
            if (action === 'boost') controls.state = {...s, boost: args[0] === 'on'};
            if (action === 'smart') controls.state = {...s, smart: args[0] === 'on'};
            if (action === 'mode') controls.state = {...s, mode: args[0] as SoundMode, effective: args[0] as SoundMode};
            if (action === 'device') controls.state = {...s, device: args[0]};
            if (action === 'custom') controls.state = {...s, custom: {...s.custom, [args[0] as CustomSlot]: args.slice(1).map(Number) as [number, number, number]}};
            return controls.state;
        },
        destroy() {calls.push('destroy');}
    };
    return controls;
}
async function verify() {
    const window = new Gtk.OffscreenWindow(); window.name = 'speaker'; window.set_size_request(900, 1200); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    const text = (id: string) => find<Gtk.Label>(id)?.get_text() ?? '';
    const labels = () => widgets(window).filter((w): w is Gtk.Label => w instanceof Gtk.Label).map(l => l.get_text());
    const mode = (id: string) => find<Gtk.Button>(`speaker-mode-${id}`);
    const ids: SoundMode[] = ['dynamic', 'game', 'movie', 'music', 'voice', 'custom1', 'custom2', 'custom3'];
    const selected = () => ids.filter(id => mode(id)?.get_style_context().has_class('power-mode-selected'));
    try {
        const calls: string[] = [], controls = fakeControls({}, calls);
        root.render(<SpeakerSettings controls={controls} />); window.show_all(); await wait();
        const all = labels();
        for (const expected of ['AI Noise-Canceling Speaker', 'Filter out all sounds except human voices from the laptop speaker', 'Choose your output device', 'Switch on to enable AI Noise-Canceling Speaker.', 'Volume Booster', 'Makes all the sounds on your device much louder, with minimum distortion.', 'Switch on to enable Volume Booster.', 'Sound Modes', 'Select your own sound modes',
            'Dynamic', 'Game', 'Movie', 'Music', 'Voice', 'Custom 1', 'Custom 2', 'Custom 3', 'Voice Mode Smart Switch'])
            assert(all.includes(expected), `Shows "${expected}"`);
        assert(text('speaker-voice-note').includes('not an AI model') && text('speaker-modes-note').includes('Dolby Atmos is not available'), 'The backend is described honestly');
        const combo = find<Gtk.ComboBoxText>('speaker-device');
        assert(combo.get_active_id() === 'alsa_output.speakers' && combo.sensitive, 'The dropdown lists the PipeWire outputs');
        assert(selected().join() === 'dynamic' && text('speaker-voice-state') === 'Off' && text('speaker-smart-state') === 'Enable', 'Defaults: Dynamic, voice filter off, smart switch on');
        find<Gtk.Switch>('speaker-voice-switch').set_active(true); await wait();
        assert(calls.includes('voice:on') && text('speaker-voice-state') === 'On', 'The voice-only switch is saved');
        find<Gtk.Switch>('speaker-boost-switch').set_active(true); await wait();
        assert(calls.includes('boost:on') && text('speaker-boost-state') === 'On' && text('speaker-boost-note').includes('not a full limiter'), 'Volume Booster is saved and described honestly');
        mode('movie').emit('clicked'); await wait();
        assert(calls.includes('mode:movie') && selected().join() === 'movie' && !find('speaker-custom-bass'), 'Choosing a sound mode applies it');
        mode('custom2').emit('clicked'); await wait();
        assert(selected().join() === 'custom2' && !!find('speaker-custom-bass') && !!find('speaker-custom-mid') && !!find('speaker-custom-treble'), 'Custom modes show bass, mid and treble');
        find<Gtk.Scale>('speaker-custom-bass').set_value(6); await wait(700);
        assert(calls.includes('custom:custom2:6:0:0') && text('speaker-custom-bass-value') === '6 dB', 'Custom levels are saved after a pause');
        find<Gtk.ComboBoxText>('speaker-device').set_active_id('alsa_output.hdmi'); await wait();
        assert(calls.includes('device:alsa_output.hdmi'), 'Choosing another output is saved');
        find<Gtk.Switch>('speaker-smart-switch').set_active(false); await wait();
        assert(calls.includes('smart:off') && text('speaker-smart-state') === 'Disable', 'The smart switch is saved');
        controls.state = {...controls.state, smart: true, mode: 'music', effective: 'voice'}; find<Gtk.Button>('speaker-mode-music').emit('clicked'); await wait();
        controls.fail = 'Administrator access was denied'; mode('game').emit('clicked'); await wait();
        assert(text('speaker-error').includes('denied'), 'Helper failures are visible');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        root.render(<Box />); await wait(); assert(calls.includes('destroy'), 'Closing the page releases the helper');

        // Call in progress: Voice mode is in use for now.
        const call = fakeControls({mode: 'music', effective: 'voice', smart: true}, []);
        root.render(<SpeakerSettings key="call" controls={call} />); await wait();
        assert(selected().join() === 'music' && text('speaker-smart-active').includes('Voice mode is in use'), 'The Voice mode switch during a call is explained');

        // Filter plugins missing: only Dynamic is offered, with the reason.
        const reason = 'Sound effects need the PipeWire filter-chain module (pipewire-modules-filter-chain), which is not installed in this system.';
        const missing = fakeControls({mode: 'movie', voice: true, filters: {available: false, reason}}, []);
        root.render(<SpeakerSettings key="missing" controls={missing} />); await wait();
        assert(selected().join() === 'dynamic' && !mode('game').sensitive && !find<Gtk.Switch>('speaker-voice-switch').sensitive && !find<Gtk.Switch>('speaker-voice-switch').active && !find<Gtk.Switch>('speaker-smart-switch').sensitive && !find<Gtk.Switch>('speaker-boost-switch').sensitive, 'Without the plugins no effect can be switched on');
        assert(text('speaker-unavailable').includes('pipewire-modules-filter-chain'), 'The missing plugin is named');

        const down = fakeControls({supported: false, reason: 'The audio server (PipeWire) is not running or pw-dump is not installed.', speakers: []}, []);
        root.render(<SpeakerSettings key="down" controls={down} />); await wait();
        assert(ids.every(id => !mode(id).sensitive) && selected().length === 0 && !!find('speaker-no-device') && text('speaker-unsupported').startsWith('Not available.'), 'Without an audio server every control is disabled and explained');

        // The Sound page shows both cards between the output and input cards.
        const audio: AudioControls = {async load() {return {inputs: [], outputs: [{id: 1, name: 'alsa_output.speakers', title: 'Speakers', volume: 50, muted: false}], applications: [], defaultInput: '', defaultOutput: 'alsa_output.speakers'};}, async volume() {}, async mute() {}, async select() {}, async route() {}, destroy() {}};
        void audio;
        root.render(<SystemSettings key="page" page="sound" speaker={fakeControls({}, [])} navigate={() => {}} monitors={[]} controls={{async load() {throw new Error('unused');}, async open() {}, async profile() {throw new Error('unused');}, destroy() {}}} />); await wait(400);
        assert(!!find('speaker-voice-card') && !!find('speaker-boost-card') && !!find('speaker-modes-card'), 'The Sound page offers the speaker cards');
    } finally {root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: AI Noise-Canceling Speaker and Sound Modes settings, custom levels, smart switch, unavailable plugins and honest backend text');
