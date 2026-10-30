import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Box, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {NetworkSettings} from '../src/apps/org.devos.settings/network-view.js';
import {ConnectivitySettings} from '../src/apps/org.devos.settings/connectivity-view.js';
import {unsupportedConnectivity, taskFirstProfiles, type ConnectivityAction, type ConnectivityControls, type ConnectivityState, type TaskFirstProfile} from '../src/apps/org.devos.settings/connectivity.js';
Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 170, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
/** In-memory stand-in for the helper: saves what is chosen and reports it back. */
function fakeControls(initial: Partial<ConnectivityState>, calls: string[]): ConnectivityControls & {state: ConnectivityState; fail?: string} {
    const controls = {
        state: {...unsupportedConnectivity, taskfirstSupported: true, smartconnectSupported: true, ...initial} as ConnectivityState, fail: undefined as string | undefined,
        async request(action: ConnectivityAction, ...args: string[]) {
            calls.push([action, ...args].join(':'));
            if (controls.fail) throw new Error(controls.fail);
            const s = controls.state;
            if (action === 'taskfirst') controls.state = {...s, taskfirst: args[0] as TaskFirstProfile, taskfirstActive: args[0] !== 'off', taskfirstInterfaces: args[0] !== 'off' ? 'wlan0' : ''};
            if (action === 'smartconnect') controls.state = {...s, smartconnect: args[0] === 'on'};
            return controls.state;
        },
        destroy() {calls.push('destroy');}
    };
    return controls;
}
async function verify() {
    const window = new Gtk.OffscreenWindow(); window.name = 'connectivity'; window.set_size_request(1000, 900); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    const text = (id: string) => find<Gtk.Label>(id)?.get_text() ?? '';
    const labels = () => widgets(window).filter((w): w is Gtk.Label => w instanceof Gtk.Label).map(l => l.get_text());
    const profile = (id: string) => find<Gtk.Button>(`taskfirst-${id}`);
    const selected = () => taskFirstProfiles.map(p => p.id).filter(id => profile(id)?.get_style_context().has_class('power-mode-selected'));
    try {
        // The Network & Internet list offers the page.
        let routed = '';
        root.render(<NetworkSettings page="network" navigate={id => {routed = id;}} />); window.show_all(); await wait();
        find<Gtk.Button>('network-category-connectivity').emit('clicked'); assert(routed === 'connectivity', 'Connectivity is a network category');
        root.render(<NetworkSettings page="connectivity" navigate={id => {routed = id;}} />); await wait();
        assert(!!find('taskfirst-card') && !!find('smartconnect-card'), 'The page shows both cards');
        find<Gtk.Button>('connectivity-back').emit('clicked'); assert(routed === 'network', 'Back returns to Network & Internet');

        // Supported system: the exact MyASUS wording, four options (no Screen Extend), Off by default.
        const calls: string[] = [], controls = fakeControls({}, calls);
        root.render(<ConnectivitySettings key="ok" back={() => {}} controls={controls} />); await wait();
        const all = labels();
        for (const expected of ['Connectivity', 'TaskFirst', "Prioritize your internet connection's available bandwidth to particular activities for the smoothest possible performance.", 'Off', 'Switch off data prioritizing',
            'Productivity and Communication', 'Prioritize productivity and communication tasks, such as loading websites, cloud drives, and communication apps', 'Multimedia streaming', 'Prioritize audio / video streaming apps and websites',
            'Games', 'Prioritize game-related tasks, such as gameplay and game live streaming', 'WiFi SmartConnect', 'Enable the WiFi SmartConnect feature to automatically connect to the wireless router with the best signal in your current environment.', 'Switch on to enable WiFi SmartConnect.'])
            assert(all.includes(expected), `Shows "${expected}"`);
        assert(!all.includes('Screen Extend') && !find('taskfirst-screen-extend'), 'Screen Extend (GlideX) does not exist in Dev OS');
        assert(text('taskfirst-honest').includes('cannot add bandwidth'), 'TaskFirst says plainly what it is');
        assert(selected().join() === 'off' && profile('games').sensitive, 'Off is selected by default and the options are usable');
        const sc = find<Gtk.Switch>('smartconnect-switch');
        assert(!sc.active && sc.sensitive && text('smartconnect-state') === 'Off', 'SmartConnect is off by default');
        profile('streaming').emit('clicked'); await wait();
        assert(calls.includes('taskfirst:streaming') && selected().join() === 'streaming' && text('taskfirst-active') === 'Active on wlan0.', 'Choosing a profile applies it and shows where it is active');
        profile('streaming').emit('clicked'); await wait(); assert(calls.filter(c => c.startsWith('taskfirst')).length === 1, 'Choosing the current profile again does nothing');
        profile('off').emit('clicked'); await wait(); assert(selected().join() === 'off' && !find('taskfirst-active'), 'Off switches prioritizing off');
        find<Gtk.Switch>('smartconnect-switch').set_active(true); await wait();
        assert(calls.includes('smartconnect:on') && find<Gtk.Switch>('smartconnect-switch').active && text('smartconnect-state') === 'On', 'The SmartConnect switch is saved');
        controls.state = {...controls.state, smartconnectLast: 'Signal of Home is good (80%); not scanning.'}; find<Gtk.Button>('taskfirst-games').emit('clicked'); await wait();
        assert(text('smartconnect-last').includes('not scanning'), 'The last SmartConnect decision is shown while it is on');
        controls.fail = 'Administrator access was denied'; profile('productivity').emit('clicked'); await wait();
        assert(text('connectivity-error').includes('denied') && selected().join() === 'games', 'Helper failures are visible and the selection reverts');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        root.render(<Box />); await wait(); assert(calls.includes('destroy'), 'Closing the page releases the helper');

        // Waiting for a connection: profile saved, nothing active yet.
        root.render(<ConnectivitySettings key="wait" back={() => {}} controls={fakeControls({taskfirst: 'games'}, [])} />); await wait();
        assert(!!find('taskfirst-waiting') && selected().join() === 'games', 'A saved profile without an interface says it is waiting');

        // Kernel without traffic control and no Wi-Fi adapter: everything disabled with the reason, nothing invented.
        const none = fakeControls({taskfirstSupported: false, smartconnectSupported: false, taskfirstReason: 'This kernel lacks the traffic control modules: sch_prio.', smartconnectReason: 'No Wi-Fi adapter managed by NetworkManager was found.', smartconnect: true}, []);
        root.render(<ConnectivitySettings key="none" back={() => {}} controls={none} />); await wait();
        assert(taskFirstProfiles.every(p => profile(p.id) && !profile(p.id).sensitive), 'Unsupported kernel disables every TaskFirst option');
        assert(text('taskfirst-unsupported').startsWith('Not supported on this system.') && text('taskfirst-unsupported').includes('sch_prio'), 'TaskFirst explains why it is unavailable');
        const off = find<Gtk.Switch>('smartconnect-switch');
        assert(!off.sensitive && !off.active && text('smartconnect-state') === 'Off' && text('smartconnect-unsupported').includes('No Wi-Fi adapter'), 'SmartConnect is off and explained without a Wi-Fi adapter');
    } finally {root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: Connectivity settings, TaskFirst profiles, WiFi SmartConnect switch, honest unsupported states');
