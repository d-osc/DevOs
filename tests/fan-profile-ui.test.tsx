import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Box, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {SystemSettings} from '../extensions/org.devos.settings/system-view.js';
import {FanProfileSettings} from '../extensions/org.devos.settings/fan-profile-view.js';
import {unsupportedFanProfile, type FanMode, type FanProfileAction, type FanProfileControls, type FanProfileState} from '../extensions/org.devos.settings/fan-profile.js';
import type {SystemControls, SystemState} from '../extensions/org.devos.settings/system.js';
Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 170, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
/** In-memory stand-in with the helper's rules: a profile is saved per power source and only the active source is applied. */
function fakeControls(initial: Partial<FanProfileState>, calls: string[]): FanProfileControls & {state: FanProfileState; fail?: string} {
    const controls = {
        state: {...unsupportedFanProfile, supported: true, backend: 'platform_profile', modes: ['performance', 'standard', 'whisper'], current: 'standard', source: 'ac', syncAvailable: true, ...initial} as FanProfileState, fail: undefined as string | undefined,
        async request(action: FanProfileAction, ...args: string[]) {
            calls.push([action, ...args].join(':'));
            if (controls.fail) throw new Error(controls.fail);
            const s = controls.state;
            if (action === 'set') {const [source, mode] = args as ['ac' | 'battery', FanMode]; controls.state = {...s, [source]: mode, current: source === s.source ? mode : s.current};}
            if (action === 'sync') controls.state = {...s, sync: args[0] === 'on'};
            return controls.state;
        },
        destroy() {calls.push('destroy');}
    };
    return controls;
}
async function verify() {
    const window = new Gtk.OffscreenWindow(); window.name = 'fan'; window.set_size_request(900, 900); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    const text = (id: string) => find<Gtk.Label>(id)?.get_text() ?? '';
    const labels = () => widgets(window).filter((w): w is Gtk.Label => w instanceof Gtk.Label).map(l => l.get_text());
    const mode = (id: string) => find<Gtk.Button>(`fan-mode-${id}`);
    const selected = () => (['performance', 'standard', 'whisper'] as const).filter(id => mode(id)?.get_style_context().has_class('power-mode-selected'));
    try {
        // Supported hardware: radios drive the helper, one profile per power source.
        const calls: string[] = [], controls = fakeControls({hotkey: true, rpm: 2400}, calls);
        root.render(<FanProfileSettings controls={controls} />); window.show_all(); await wait();
        const all = labels();
        for (const expected of ['Fan Profile', 'Select a preferred fan speed.', 'Performance mode', 'Dynamically maximizes cooling performance for demanding tasks.', 'Standard mode', 'Dynamically selects the best fan speed for everyday tasks.', 'Whisper mode', 'Dynamically minimizes fan speed for the quietest operation.', 'Power Mode Synchronization', 'Dynamically adjusts your power mode based on the Fan Profile setting for optimal performance.'])
            assert(all.includes(expected), `Shows "${expected}"`);
        assert(text('fan-profile-hotkey').includes('[Fn] + [F]') && text('fan-profile-rpm') === 'Fan speed: 2400 RPM', 'Hotkey hint and fan speed are shown when the hardware has them');
        assert(text('fan-profile-source') === 'Plugged-in (current power source)', 'Names the active power source');
        assert(selected().join() === 'standard' && mode('performance').sensitive, 'The current profile is selected');
        mode('whisper').emit('clicked'); await wait();
        assert(calls.includes('set:ac:whisper') && selected().join() === 'whisper' && controls.state.current === 'whisper', 'Choosing Whisper applies it for the plugged-in source');
        find<Gtk.Button>('fan-source-battery').emit('clicked'); await wait();
        assert(text('fan-profile-source') === 'Applies when on battery' && selected().join() === 'standard', 'The battery tab shows its own (unsaved) profile');
        mode('performance').emit('clicked'); await wait();
        assert(calls.includes('set:battery:performance') && controls.state.current === 'whisper' && selected().join() === 'performance', 'Choosing a profile for battery does not change the active hardware profile');
        const sync = find<Gtk.Switch>('fan-sync-switch');
        assert(sync.sensitive && sync.active && text('fan-sync-state') === 'Enable', 'Power Mode Synchronization is on by default');
        sync.set_active(false); await wait();
        assert(calls.includes('sync:off') && !find<Gtk.Switch>('fan-sync-switch').active && text('fan-sync-state') === 'Disable', 'The synchronization switch is saved');
        controls.fail = 'Administrator access was denied'; find<Gtk.Button>('fan-mode-standard').emit('clicked'); await wait();
        assert(text('fan-profile-error').includes('denied'), 'Helper failures are visible');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        root.render(<Box />); await wait(); assert(calls.includes('destroy'), 'Closing the page releases the helper');

        // No power-profiles-daemon: the profile still works, synchronization is off with a reason; the emulated backend is labelled.
        const emulated = fakeControls({backend: 'cpufreq', emulated: true, syncAvailable: false, modes: ['performance', 'standard']}, []);
        root.render(<FanProfileSettings key="emulated" controls={emulated} />); await wait();
        assert(!find<Gtk.Switch>('fan-sync-switch').sensitive && !!find('fan-sync-unavailable'), 'Synchronization is disabled when power modes are unavailable');
        assert(text('fan-profile-emulated').includes('CPU performance policy') && !mode('whisper') && !find('fan-profile-hotkey'), 'Emulated profiles are labelled and only offer what the kernel does');

        // Hardware without any fan or thermal interface (this Snapdragon laptop): the card is shown disabled with the reason.
        const none = fakeControls({supported: false, modes: [], current: '', backend: '', rpm: 2400, reason: 'This device exposes no fan or thermal policy (no platform_profile, asus-wmi throttle policy or cpufreq governors). The embedded controller only reports fan speed.'}, []);
        root.render(<FanProfileSettings key="none" controls={none} />); await wait();
        assert(['performance', 'standard', 'whisper'].every(id => mode(id) && !mode(id).sensitive) && selected().length === 0, 'Unsupported hardware shows every profile disabled and none selected');
        assert(!find<Gtk.Switch>('fan-sync-switch').sensitive && !find('fan-source-ac') && !find('fan-profile-rpm'), 'No source tabs, speed or synchronization without a backend');
        assert(text('fan-profile-unsupported').startsWith('Not supported on this device.') && text('fan-profile-unsupported').includes('no platform_profile'), 'Unsupported hardware explains why');

        // The Power page shows the card unless Windows manages the machine.
        const sys: SystemState = {hostManaged: false, hostname: 'DevOs', os: 'DevOs', kernel: 'Linux', architecture: 'aarch64', cpu: 'ARM', processors: 8, memory: 1, session: 'wayland', desktopBuild: {}, storage: [], batteries: [], power: {available: false, active: '', profiles: [], degraded: '', error: ''}, tools: {}, hostSettings: false};
        let current = sys;
        const system: SystemControls = {async load() {return current;}, async open() {}, async profile() {return current;}, destroy() {}};
        root.render(<SystemSettings page="power" controls={system} fan={fakeControls({}, [])} navigate={() => {}} monitors={[]} />); await wait();
        assert(!!find('fan-profile-card'), 'Power & battery page offers the Fan Profile');
        current = {...sys, hostManaged: true}; find<Gtk.Button>('system-refresh').emit('clicked'); await wait();
        assert(!find('fan-profile-card'), 'No card when Windows manages power');
    } finally {root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: Fan Profile settings, per-source profiles, synchronization, emulated and unsupported hardware');
