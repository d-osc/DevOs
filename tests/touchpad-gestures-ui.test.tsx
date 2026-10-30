import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Box, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {TouchpadGesturesSettings} from '../src/apps/org.devos.settings/touchpad-gestures-view.js';
import {TouchpadSettings} from '../src/apps/org.devos.settings/touchpad-view.js';
import {unsupportedTouchpadGestures, gestureTargets, type GestureTarget, type TouchpadGesturesAction, type TouchpadGesturesControls, type TouchpadGesturesState} from '../src/apps/org.devos.settings/touchpad-gestures.js';
import {defaultTouchpad, type TouchpadControls} from '../src/apps/org.devos.settings/touchpad.js';
Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 170, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
/** In-memory stand-in with the helper's rules. */
function fakeControls(initial: Partial<TouchpadGesturesState>, calls: string[]): TouchpadGesturesControls & {state: TouchpadGesturesState; fail?: string} {
    const controls = {
        state: {...unsupportedTouchpadGestures, supported: true, devices: ['ASUE1234:00 04F3:3294 Touchpad'], gesturesAvailable: true, backends: {volume: true, brightness: true, seek: true, launch: true}, ...initial} as TouchpadGesturesState, fail: undefined as string | undefined,
        async request(action: TouchpadGesturesAction, ...args: string[]) {
            calls.push([action, ...args].join(':'));
            if (controls.fail) throw new Error(controls.fail);
            const s = controls.state;
            if (action === 'lock') controls.state = {...s, locked: args[0] === 'on'};
            if (action === 'gestures') controls.state = {...s, enabled: args[0] === 'on'};
            if (action === 'launch') controls.state = {...s, launch: args[0] as GestureTarget};
            return controls.state;
        },
        destroy() {calls.push('destroy');}
    };
    return controls;
}
async function verify() {
    const window = new Gtk.OffscreenWindow(); window.name = 'tp'; window.set_size_request(1000, 900); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    const text = (id: string) => find<Gtk.Label>(id)?.get_text() ?? '';
    const labels = () => widgets(window).filter((w): w is Gtk.Label => w instanceof Gtk.Label).map(l => l.get_text());
    try {
        const calls: string[] = [], controls = fakeControls({}, calls);
        root.render(<TouchpadGesturesSettings controls={controls} />); window.show_all(); await wait();
        const all = labels();
        for (const expected of ['Touchpad', 'When set to Lock, touchpad input is disabled.', 'Lock/unlock the touchpad input function', 'Unlock', 'Smart Gestures', 'Quickly access commonly used settings and apps', 'Enable/disable advanced gestures', 'Disable',
            'Adjust volume', 'Slide one finger along the left edge', 'Adjust brightness', 'Slide one finger along the right edge', 'Forward/Rewind', 'Slide one finger across the top edge', 'Launch Task Manager', 'Swipe in from the top-right corner with one finger'])
            assert(all.includes(expected), `Shows "${expected}"`);
        assert(!!find('touchpad-diagram') && find<Gtk.Switch>('touchpad-lock-switch').active && !find<Gtk.Switch>('touchpad-gestures-switch').active, 'Unlocked and gestures disabled by default');
        // Lock: the switch shows Unlock while the touchpad works; turning it off locks.
        find<Gtk.Switch>('touchpad-lock-switch').set_active(false); await wait();
        assert(calls.includes('lock:on') && controls.state.locked && text('touchpad-lock-state') === 'Lock' && !find<Gtk.Switch>('touchpad-lock-switch').active, 'Switching to Lock disables the touchpad');
        find<Gtk.Switch>('touchpad-lock-switch').set_active(true); await wait();
        assert(calls.includes('lock:off') && !controls.state.locked && text('touchpad-lock-state') === 'Unlock', 'Switching back unlocks');
        // Gestures and the corner app.
        find<Gtk.Switch>('touchpad-gestures-switch').set_active(true); await wait();
        assert(calls.includes('gestures:on') && text('touchpad-gestures-state') === 'Enable', 'Enabling gestures is saved');
        find<Gtk.ComboBoxText>('touchpad-gesture-launch').set_active_id('launcher'); await wait();
        assert(calls.includes('launch:launcher') && labels().includes('Launch Application launcher'), 'The corner swipe app can be chosen');
        // Locked touchpad pauses gestures with an explanation.
        find<Gtk.Switch>('touchpad-lock-switch').set_active(false); await wait();
        assert(text('touchpad-gestures-locked').includes('paused'), 'Locking explains that gestures are paused');
        // Failures are visible and the switch snaps back.
        controls.fail = 'Compositor reload failed';
        find<Gtk.Switch>('touchpad-lock-switch').set_active(true); await wait();
        assert(text('touchpad-gestures-error').includes('reload failed'), 'Helper failures are visible');
        assert(!find<Gtk.Switch>('touchpad-lock-switch').active && text('touchpad-lock-state') === 'Lock', 'The switch returns to the real state after a failure');
        root.render(<Box />); await wait(); assert(calls.includes('destroy'), 'Closing the page releases the helper');

        // No touchpad: everything is disabled with the reason, nothing is claimed.
        const none = fakeControls({supported: false, devices: [], gesturesAvailable: false, reason: 'No touchpad was detected on this device.', backends: {volume: true, brightness: true, seek: false, launch: true}}, []);
        root.render(<TouchpadGesturesSettings key="none" controls={none} />); await wait();
        assert(!find<Gtk.Switch>('touchpad-lock-switch').sensitive && !find<Gtk.Switch>('touchpad-gestures-switch').sensitive && !find<Gtk.ComboBoxText>('touchpad-gesture-launch').sensitive, 'Controls are disabled without a touchpad');
        assert(text('touchpad-lock-unsupported').includes('No touchpad was detected') && text('touchpad-gestures-unsupported').includes('No touchpad was detected'), 'Both cards explain why');

        // A touchpad this user cannot read: the lock still works, gestures are disabled with the reason.
        const unreadable = fakeControls({gesturesAvailable: false, reason: 'The touchpad cannot be read by this user, so edge gestures cannot work. The lock is not affected.'}, []);
        root.render(<TouchpadGesturesSettings key="unreadable" controls={unreadable} />); await wait();
        assert(find<Gtk.Switch>('touchpad-lock-switch').sensitive && !find<Gtk.Switch>('touchpad-gestures-switch').sensitive, 'Lock stays usable, gestures disabled');
        assert(text('touchpad-gestures-unavailable').includes('cannot be read'), 'Explains the unreadable device');

        // A missing backend is named per gesture.
        const partial = fakeControls({backends: {volume: true, brightness: false, seek: false, launch: true}}, []);
        root.render(<TouchpadGesturesSettings key="partial" controls={partial} />); await wait();
        assert(labels().filter(l => l.endsWith('· unavailable on this system')).length === 2, 'Brightness and seek are marked unavailable');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);

        // The cards sit on the Touchpad page next to the pointer options.
        const touchpad: TouchpadControls = {async request() {return {settings: {...defaultTouchpad}, devices: [], applied: false};}, destroy() {}};
        root.render(<TouchpadSettings key="page" controls={touchpad} gestureControls={fakeControls({}, [])} back={() => {}} />); await wait();
        assert(!!find('touchpad-lock-card') && !!find('touchpad-gestures-card') && !!find('touchpad-speed'), 'The Touchpad page offers the lock, the gestures and the pointer options');
        assert(gestureTargets.some(target => target.id === 'task-manager'), 'Task Manager is a corner target');
    } finally {root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: Touchpad lock and Smart Gestures settings, failures, missing touchpad and backends');
