import {React, Gtk, Gdk, GLib, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {TimeSettings} from '../extensions/org.devos.settings/time-view.js';
import type {TimeControls, TimeState, TimeAction} from '../extensions/org.devos.settings/time.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    let state: TimeState = {available: true, hostManaged: false, timezone: 'Asia/Bangkok', ntp: true, canNtp: true, synchronized: true, zones: ['Asia/Bangkok', 'UTC'], error: ''};
    let action: TimeAction | undefined, opened = 0, clocks = 0, released = 0, fail = false;
    const controls: TimeControls = {async load() {return state;}, async update(next) {if (fail) throw new Error('Authorization denied'); action = next; if (next.action === 'set-ntp') state = {...state, ntp: next.enabled}; if (next.action === 'set-timezone') state = {...state, timezone: next.timezone}; return state;}, async openHostSettings() {opened++;}, destroy() {released++;}};
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(850, 950);
    const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replaceAll('@ACCENT@', '#88e0c0')));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    try {
        root.render(<TimeSettings controls={controls} showClock={() => {clocks++;}} />); window.show_all(); await wait();
        assert(find<Gtk.Label>('time-sync-state').get_text() === 'SYNCHRONIZED' && !find<Gtk.Button>('time-set-manual').get_sensitive(), 'Live sync status loads and automatic time protects manual input');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        find<Gtk.Switch>('time-automatic').set_active(false); await wait();
        assert(action?.action === 'set-ntp' && !action.enabled && find<Gtk.Button>('time-set-manual').get_sensitive(), 'Turning NTP off unlocks manual time');
        find<Gtk.ComboBoxText>('time-zone').set_active_id('UTC'); find<Gtk.Button>('time-apply-zone').emit('clicked'); await wait();
        assert(state.timezone === 'UTC' && find('time-status'), 'Timezone Apply updates system state');
        find<Gtk.Entry>('time-date').set_text('2026-10-17'); find<Gtk.Entry>('time-value').set_text('09:30'); find<Gtk.Button>('time-set-manual').emit('clicked'); await wait();
        assert(action?.action === 'set-time' && action.date === '2026-10-17' && action.time === '09:30', 'Manual date/time routed without shell parsing');
        fail = true; find<Gtk.Switch>('time-automatic').set_active(true); await wait();
        assert(find<Gtk.Label>('time-error').get_text().includes('Authorization denied') && !find<Gtk.Switch>('time-automatic').active, 'Authorization failure is visible and the switch returns to its actual state');
        find<Gtk.Button>('time-clock-settings').emit('clicked'); assert(clocks === 1, 'Clock appearance link works');
        state = {...state, hostManaged: true}; root.render(<TimeSettings key="wsl" controls={controls} />); await wait();
        assert(!find<Gtk.Switch>('time-automatic').get_sensitive() && !find<Gtk.Button>('time-set-manual').get_sensitive() && find('time-host-settings'), 'WSL guards system clock changes and offers host settings');
        find<Gtk.Button>('time-host-settings').emit('clicked'); await wait(); assert(opened === 1, 'Host settings opens only on explicit click');
        state = {...state, available: false, error: 'No time service'}; root.render(<TimeSettings key="offline" controls={controls} />); await wait();
        assert(!find<Gtk.ComboBoxText>('time-zone').get_sensitive() && find('time-service-error'), 'Unavailable time service disables controls and reports its status');
    } finally {root.unmount(); window.destroy(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css);}
    assert(released === 3, 'Every page instance releases backend resources');
    print('PASS: Time UI, timezone/NTP/manual actions, auth errors, WSL/offline states and cleanup');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
