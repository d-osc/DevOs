import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Box, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {SystemSettings} from '../extensions/org.devos.settings/system-view.js';
import {BatteryCareSettings} from '../extensions/org.devos.settings/battery-care-view.js';
import {remainingText, unsupportedBatteryCare, type BatteryCareAction, type BatteryCareControls, type BatteryCareState} from '../extensions/org.devos.settings/battery-care.js';
import {PanelFullCharge} from '../extensions/org.devos.panel/battery-view.js';
import type {SystemControls, SystemState} from '../extensions/org.devos.settings/system.js';
Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 170, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
/** In-memory stand-in with the helper's rules: Instant Full-Charge needs Battery Care, and turning Care on or off ends it. */
function fakeControls(initial: Partial<BatteryCareState>, calls: string[]): BatteryCareControls & {state: BatteryCareState; fail?: string} {
    const controls = {
        state: {...unsupportedBatteryCare, supported: true, battery: 'BAT0', threshold: 100, ...initial} as BatteryCareState, fail: undefined as string | undefined,
        async request(action: BatteryCareAction, enabled?: boolean) {
            calls.push(`${action}${enabled === undefined ? '' : `:${enabled}`}`);
            if (controls.fail) throw new Error(controls.fail);
            const s = controls.state;
            if (action === 'care') controls.state = {...s, care: Boolean(enabled), full: false, fullUntil: 0, remaining: 0, threshold: enabled ? 80 : 100};
            if (action === 'full') controls.state = {...s, full: Boolean(enabled), fullUntil: enabled ? 1 : 0, remaining: enabled ? 86400 : 0, threshold: enabled ? 100 : 80};
            if (action === 'quick') controls.state = {...s, quick: Boolean(enabled)};
            return controls.state;
        },
        destroy() {calls.push('destroy');}
    };
    return controls;
}
async function verify() {
    assert(remainingText(86400) === '24 h 0 min' && remainingText(3599) === '1 h 0 min' && remainingText(3000) === '50 min' && remainingText(5) === '1 min', 'Remaining time is formatted for people');
    const window = new Gtk.OffscreenWindow(); window.name = 'battery'; window.set_size_request(900, 760); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    const text = (id: string) => find<Gtk.Label>(id)?.get_text() ?? '';
    try {
        // Supported hardware: the switches drive the helper and interact like MyASUS.
        const calls: string[] = [], controls = fakeControls({}, calls);
        root.render(<BatteryCareSettings controls={controls} />); window.show_all(); await wait();
        const full = () => find<Gtk.Switch>('battery-full-switch'), care = () => find<Gtk.Switch>('battery-care-switch');
        assert(care().sensitive && !care().active && !full().sensitive, 'Care is available and Instant Full-Charge waits for Care');
        assert(!!find('battery-full-hint') && !find('battery-care-unsupported'), 'Explains how to unlock Instant Full-Charge');
        care().set_active(true); await wait();
        assert(calls.includes('care:true') && care().active && full().sensitive && controls.state.threshold === 80, 'Battery Care Mode limits charging to 80%');
        full().set_active(true); await wait();
        assert(calls.includes('full:true') && full().active && controls.state.threshold === 100 && care().active, 'Instant Full-Charge charges to 100% while Care stays saved');
        assert(text('battery-full-remaining') === 'Battery Care Mode returns in 24 h 0 min.', 'Shows when Care returns');
        full().set_active(false); await wait();
        assert(!full().active && care().active && controls.state.threshold === 80 && !find('battery-full-remaining'), 'Ending the full charge restores 80%');
        full().set_active(true); await wait(); care().set_active(false); await wait();
        assert(!care().active && !full().active && controls.state.threshold === 100 && !full().sensitive, 'Turning Care off ends Instant Full-Charge');
        const check = find<Gtk.CheckButton>('battery-quick-check');
        assert(check.active, 'Quick switch is shown in the panel by default'); check.set_active(false); await wait();
        assert(calls.includes('quick:false') && !controls.state.quick, 'The panel-switch preference is saved');
        controls.fail = 'Administrator access was denied'; care().set_active(true); await wait();
        assert(text('battery-care-error').includes('denied') && !care().active, 'Helper failures are visible and the switch does not lie');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        root.render(<Box />); await wait(); assert(calls.includes('destroy'), 'Closing the page releases the helper');

        // Hardware without a charge limit (this Snapdragon board's battery driver): controls stay off with a plain explanation.
        const none = fakeControls({supported: false, battery: 'qcom-battmgr-bat', reason: 'The battery driver on this device does not provide a charge limit (no charge_control_end_threshold).'}, []);
        root.render(<BatteryCareSettings controls={none} />); await wait();
        assert(!care().sensitive && !full().sensitive && !find<Gtk.CheckButton>('battery-quick-check').sensitive, 'Unsupported hardware disables every control');
        assert(text('battery-care-unsupported').startsWith('Not supported on this device.') && text('battery-care-unsupported').includes('charge_control_end_threshold'), 'Unsupported hardware explains why');

        // The Power page shows the card only when the system reports a battery.
        let sys: SystemState = {hostManaged: false, hostname: 'DevOs', os: 'DevOs', kernel: 'Linux', architecture: 'aarch64', cpu: 'ARM', processors: 8, memory: 1, session: 'wayland', desktopBuild: {}, storage: [], batteries: [{name: 'BAT0', status: 'Discharging', percent: 76}], power: {available: false, active: '', profiles: [], degraded: '', error: ''}, tools: {}, hostSettings: false};
        const system: SystemControls = {async load() {return sys;}, async open() {}, async profile() {return sys;}, destroy() {}};
        root.render(<SystemSettings page="power" controls={system} battery={fakeControls({}, [])} navigate={() => {}} monitors={[]} />); await wait();
        assert(!!find('battery-care-card'), 'Power & battery page offers Battery Care Mode');
        sys = {...sys, batteries: []}; find<Gtk.Button>('system-refresh').emit('clicked'); await wait();
        assert(!find('battery-care-card'), 'No card without a battery');

        // Panel quick switch.
        const panelCalls: string[] = [], panel = fakeControls({care: true, threshold: 80}, panelCalls);
        root.render(<PanelFullCharge controls={panel} />); await wait();
        const quick = () => find<Gtk.Switch>('panel-full-charge');
        assert(!!quick() && !quick().active && text('panel-full-charge-detail').includes('limits charging to 80%'), 'Panel offers Instant Full-Charge while Care is on');
        quick().set_active(true); await wait();
        assert(panelCalls.includes('full:true') && quick().active && text('panel-full-charge-detail').includes('Charging to 100%'), 'Panel switch starts a full charge');
        for (const hidden of [{supported: false}, {quick: false}, {care: false}] as Partial<BatteryCareState>[]) {
            root.render(<PanelFullCharge key={JSON.stringify(hidden)} controls={fakeControls(hidden, [])} />); await wait();
            assert(!quick(), `Panel switch is hidden for ${JSON.stringify(hidden)}`);
        }
    } finally {root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: Battery Care Mode and Instant Full-Charge settings, unsupported hardware and panel switch');
