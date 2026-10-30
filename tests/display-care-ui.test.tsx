import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Box, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {SystemSettings} from '../src/apps/org.devos.settings/system-view.js';
import {DisplayCareSettings} from '../src/apps/org.devos.settings/display-care-view.js';
import {unsupportedDisplayCare, type CareSettings, type DisplayCareAction, type DisplayCareControls, type DisplayCareState} from '../src/apps/org.devos.settings/display-care.js';
import {defaultCare, parseCare} from '../src/legacy/display-care.js';
import type {SystemControls, SystemState} from '../src/apps/org.devos.settings/system.js';
Gtk.init(null);
const wait = (ms = 420) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const capable = {available: true, reason: ''};
/** In-memory stand-in with the helper's rules: values are saved, a reset restores only the Splendid group and dimming. */
function fakeControls(initial: Partial<DisplayCareState>, calls: string[]): DisplayCareControls & {state: DisplayCareState; fail?: string} {
    const controls = {
        state: {...unsupportedDisplayCare, settings: {...defaultCare}, gamma: capable, idle: capable, ereading: {available: false, reason: 'A gamma table cannot remove colour.'}, gamut: {available: false, reason: 'No colour management in the compositor.', options: ['native']}, battery: {present: true, onBattery: false}, ...initial} as DisplayCareState, fail: undefined as string | undefined,
        async request(action: DisplayCareAction, ...args: string[]) {
            calls.push([action, ...args].join(':'));
            if (controls.fail) throw new Error(controls.fail);
            const s = controls.state;
            if (action === 'set') {const value = args[1] === 'on' ? true : args[1] === 'off' ? false : isNaN(Number(args[1])) ? args[1] : Number(args[1]); controls.state = {...s, settings: {...s.settings, [args[0]]: value} as CareSettings};}
            if (action === 'reset') controls.state = {...s, settings: {...s.settings, splendid: 'normal', temperature: 0, eyeCare: 3, dimming: 100}, brightness: {ok: true, percent: 70}};
            return controls.state;
        },
        destroy() {calls.push('destroy');}
    };
    return controls;
}
async function verify() {
    const window = new Gtk.OffscreenWindow(); window.name = 'display-care'; window.set_size_request(1000, 1500); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    const text = (id: string) => find<Gtk.Label>(id)?.get_text() ?? '';
    const labels = () => widgets(window).filter((w): w is Gtk.Label => w instanceof Gtk.Label).map(l => l.get_text());
    const mode = (id: string) => find<Gtk.Button>(`splendid-${id}`);
    const selected = () => ['normal', 'vivid', 'manual', 'eyecare'].filter(id => mode(id)?.get_style_context().has_class('power-mode-selected'));
    const toggle = (id: string) => find<Gtk.Switch>(`${id}-switch`);
    try {
        // Parsing shared with the shell: every value is checked on its own.
        const parsed = parseCare('{"dimming": 20, "splendid": "ereading", "temperature": 99, "targetMode": "yes", "pixelRefresh": false}');
        assert(parsed.dimming === 20 && parsed.splendid === 'normal' && parsed.temperature === 0 && parsed.targetMode === false && parsed.pixelRefresh === false, 'Invalid values fall back one by one');
        const fallback = parseCare('{broken');
        assert(Object.keys(fallback).length === Object.keys(defaultCare).length && Object.entries(defaultCare).every(([key, value]) => fallback[key as keyof CareSettings] === value)
            && defaultCare.pixelRefresh && defaultCare.panelTransparency && !defaultCare.autoHidePanel && defaultCare.dimming === 100, 'A damaged file gives the defaults (Pixel refresh and transparency on, auto-hide off)');

        // Supported hardware: every card shows the MyASUS wording and drives the helper.
        const calls: string[] = [], controls = fakeControls({}, calls);
        root.render(<DisplayCareSettings controls={controls} />); window.show_all(); await wait();
        const all = labels();
        for (const expected of ['OLED Care', 'Pixel refresh', 'Automatically hide the panel in desktop mode', 'Panel transparency effect', 'OLED Flicker-Free Dimming', 'Drag to adjust the dimming level of your OLED panel', 'Splendid', 'Display Settings', 'Normal', 'Vivid', 'Manual', 'Eye Care', 'E-Reading', 'Color Gamut', 'Target Mode', 'Adaptive Edge Brightness', 'This feature is only supported in DC mode.', 'Reset to recommended settings'])
            assert(all.includes(expected), `Shows "${expected}"`);
        assert(all.some(label => label.startsWith('Notice: Avoid displaying static images at maximum brightness')), 'Burn-in notice');
        assert(text('pixel-shift-notice').includes('permanently enabled and cannot be disabled'), 'Pixel Shift is announced as always on');
        assert(find<Gtk.Label>('pixel-shift-notice').get_style_context().has_class('settings-notice'), 'Notices use the warning style');
        assert(toggle('pixel-refresh').active && !toggle('panel-autohide').active && toggle('panel-transparency').active && !toggle('target-mode').active, 'Defaults: Pixel refresh On, auto-hide Off, transparency On, Target Mode Off');
        assert(text('pixel-refresh-state') === 'On' && text('panel-autohide-state') === 'Off', 'State labels follow the switches');
        assert(selected().join() === 'normal', 'Normal is selected by default');

        toggle('panel-autohide').set_active(true); await wait();
        assert(calls.includes('set:autoHidePanel:on') && controls.state.settings.autoHidePanel, 'Auto-hide is saved');
        toggle('panel-transparency').set_active(false); toggle('target-mode').set_active(true); toggle('pixel-refresh').set_active(false); await wait(700);
        assert(['set:panelTransparency:off', 'set:targetMode:on', 'set:pixelRefresh:off'].every(call => calls.includes(call)), 'Queued toggles are all saved');
        const s = controls.state.settings; assert(!s.panelTransparency && s.targetMode && !s.pixelRefresh && s.autoHidePanel, 'Nothing was lost when toggles were changed together');

        mode('manual').emit('clicked'); await wait();
        assert(calls.includes('set:splendid:manual') && selected().join() === 'manual', 'Manual mode is saved and selected');
        assert(find<Gtk.Scale>('splendid-temperature-scale').sensitive && !find<Gtk.Scale>('splendid-eyecare-scale').sensitive, `Only the slider of the active mode is live (${find<Gtk.Scale>('splendid-temperature-scale')?.sensitive}, ${find<Gtk.Scale>('splendid-eyecare-scale')?.sensitive}, ${selected()})`);
        find<Gtk.Scale>('splendid-temperature-scale').set_value(-30); await wait(900);
        assert(calls.includes('set:temperature:-30'), 'Colour temperature is saved once the slider stops');
        mode('eyecare').emit('clicked'); await wait();
        assert(find<Gtk.Scale>('splendid-eyecare-scale').sensitive && !find<Gtk.Scale>('splendid-temperature-scale').sensitive, 'Eye Care enables its own slider');
        find<Gtk.Scale>('splendid-eyecare-scale').set_value(5); await wait(900); assert(calls.includes('set:eyeCare:5'), 'Eye Care level is saved');
        mode('vivid').emit('clicked'); await wait(); assert(text('splendid-vivid-note').includes('contrast boost'), 'Vivid says what it really does');

        find<Gtk.Scale>('dimming-scale').set_value(40); await wait(900);
        assert(calls.includes('set:dimming:40') && controls.state.settings.dimming === 40, 'Flicker-free dimming level is saved');
        const before = calls.length; const dimming = find<Gtk.Scale>('dimming-scale'); dimming.set_value(10); dimming.set_value(20); dimming.set_value(30); await wait(900);
        assert(calls.slice(before).filter(call => call.startsWith('set:dimming')).join() === 'set:dimming:30', 'A drag saves only where it stops');
        find<Gtk.Scale>('edge-scale').set_value(3); await wait(900); assert(calls.includes('set:edgeBrightness:3'), 'Adaptive Edge Brightness is saved');
        assert(text('edge-source').startsWith('Plugged in'), 'Edge brightness explains that it waits for battery power');

        // E-Reading and Color Gamut are shown, disabled, with the reason - never faked.
        assert(!mode('ereading').sensitive && text('splendid-ereading-note').startsWith('Not supported on this device.') && text('splendid-ereading-note').includes('gamma table'), 'E-Reading is disabled with a reason');
        assert(!find<Gtk.ComboBoxText>('gamut-select').sensitive && find<Gtk.ComboBoxText>('gamut-select').get_active_id() === 'native' && text('gamut-note').includes('sRGB and DCI-P3 are not available'), 'Color Gamut offers only Native and says why');

        find<Gtk.Button>('splendid-reset').emit('clicked'); await wait();
        const r = controls.state.settings;
        assert(calls.includes('reset') && r.splendid === 'normal' && r.dimming === 100 && r.temperature === 0 && selected().join() === 'normal', 'Reset restores Splendid and dimming');
        assert(r.targetMode && !r.pixelRefresh && r.autoHidePanel, 'Reset leaves the OLED Care and Target Mode switches alone');
        assert(find<Gtk.Scale>('dimming-scale').get_value() === 100, 'The dimming slider follows the reset');
        assert(!find('splendid-reset-note'), 'No note when the backlight was restored');

        controls.fail = 'Display settings failed.'; mode('vivid').emit('clicked'); await wait();
        assert(text('display-care-error').includes('failed') && selected().join() === 'normal', 'Helper failures are visible and the selection snaps back');
        controls.fail = undefined;
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        root.render(<Box />); await wait(); assert(calls.includes('destroy'), 'Closing the page releases the helper');

        // A failed backlight reset is reported.
        const dim = fakeControls({settings: {...defaultCare, dimming: 30}}, []); const original = dim.request.bind(dim);
        dim.request = async (action, ...args) => {const state = await original(action, ...args); return action === 'reset' ? {...state, brightness: {ok: false, reason: 'No kernel backlight device is available.'}} : state;};
        root.render(<DisplayCareSettings key="backlight" controls={dim} />); await wait();
        find<Gtk.Button>('splendid-reset').emit('clicked'); await wait();
        assert(text('splendid-reset-note').includes('No kernel backlight device'), 'A backlight that cannot be restored is reported');

        // Compositor without gamma control or idle notifications, and a desktop without a battery.
        const bare = fakeControls({gamma: {available: false, reason: 'The compositor does not offer wlr-gamma-control.'}, idle: {available: false, reason: 'The compositor does not report idle time.'}, battery: {present: false, onBattery: false}}, []);
        root.render(<DisplayCareSettings key="bare" controls={bare} />); await wait();
        assert(!find<Gtk.Scale>('dimming-scale').sensitive && !mode('normal').sensitive && !mode('manual').sensitive && find<Gtk.Button>('splendid-reset').sensitive, 'Without gamma control the colour controls are off (reset stays available for the backlight)');
        assert(text('flicker-unsupported').startsWith('Not supported on this device.') && text('flicker-unsupported').includes('wlr-gamma-control'), 'Dimming explains why it is off');
        assert(!toggle('pixel-refresh').sensitive && text('pixel-refresh-note').includes('does not report idle time'), 'Pixel refresh explains a missing idle protocol');
        assert(!find<Gtk.Scale>('edge-scale').sensitive && text('edge-unsupported').includes('No battery'), 'No battery, no Adaptive Edge Brightness');
        assert(toggle('panel-autohide').sensitive && toggle('panel-transparency').sensitive && toggle('target-mode').sensitive, 'Shell-drawn effects need no compositor protocol');

        // The Display page shows the cards unless Windows manages the machine.
        const sys: SystemState = {hostManaged: false, hostname: 'DevOs', os: 'DevOs', kernel: 'Linux', architecture: 'aarch64', cpu: 'ARM', processors: 8, memory: 1, session: 'wayland', desktopBuild: {}, storage: [], batteries: [], power: {available: false, active: '', profiles: [], degraded: '', error: ''}, tools: {}, hostSettings: false};
        let current = sys;
        const system: SystemControls = {async load() {return current;}, async open() {}, async profile() {return current;}, destroy() {}};
        root.render(<SystemSettings page="display" controls={system} care={fakeControls({}, [])} navigate={() => {}} monitors={[]} />); await wait();
        assert(!!find('oled-care-card') && !!find('flicker-card') && !!find('splendid-card') && !!find('target-card') && !!find('edge-card'), 'Display page offers the care cards');
        current = {...sys, hostManaged: true}; find<Gtk.Button>('system-refresh').emit('clicked'); await wait();
        assert(!find('oled-care-card'), 'No cards when Windows manages the display');
    } finally {root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: Display care settings (OLED Care, Flicker-Free Dimming, Splendid, Target Mode, Adaptive Edge Brightness)');
