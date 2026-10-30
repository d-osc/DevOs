import {Gtk, GLib, GtkLayerShell} from '@dev-os/core';
import {PowerLoading} from '../packages/compat/panel-legacy/power-loading.js';
import {requestPower} from '../packages/compat/panel-legacy/power.js';
Gtk.init(null);
const application = new Gtk.Application({application_id: 'org.devos.PowerLoadingTest'});
application.register(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
async function verify() {
    if (GtkLayerShell.is_supported()) {
        const native = new PowerLoading('shutdown'); await native.ready;
        const windows = application.get_windows().filter(window => window.name === 'devos-power-loading');
        assert(windows.length && windows.every(window => window.get_visible() && GtkLayerShell.is_layer_window(window)), 'Native power loading maps as a layer surface');
        native.destroy();
        print('PASS: native Wayland power loading surfaces');
    }
    for (const action of ['restart', 'shutdown'] as const) {
        const windows: Gtk.Window[] = [];
        let destroyed = 0;
        const loading = new PowerLoading(action, () => {const window = new Gtk.Window(); window.connect('destroy', () => {destroyed++;}); windows.push(window); return window;});
        await loading.ready;
        assert(windows.length && windows.every(window => window.get_visible()), 'Loading covers each monitor');
        const box = windows[0]!.get_child() as Gtk.Box;
        assert(box.get_children().some(child => child instanceof Gtk.Spinner && child.active), 'Loading spinner animates');
        assert((box.get_children()[1] as Gtk.Label).label === (action === 'restart' ? 'Restarting…' : 'Shutting down…'), 'Action label is correct');
        loading.destroy(); loading.destroy();
        assert(destroyed === windows.length, 'Error cleanup removes each overlay exactly once');
    }
    for (const status of ['yes', 'challenge']) {
        const events: string[] = [];
        await requestPower('restart', false, {
            call: async method => {events.push(method); return method === 'CanReboot' ? new GLib.Variant('(s)', [status]) : new GLib.Variant('()', []);},
            loading: () => {events.push('loading'); return {ready: Promise.resolve().then(() => {events.push('painted');}), destroy: () => events.push('destroy')};},
        });
        assert(status === 'yes' ? events.indexOf('painted') < events.indexOf('Reboot') : events.indexOf('Reboot') < events.indexOf('loading'), 'Paint before power request; authentication before overlay');
    }
    let destroyed = false, rejected = false;
    try {
        await requestPower('shutdown', false, {
            call: async method => {if (method === 'CanPowerOff') return new GLib.Variant('(s)', ['yes']); throw new Error('Power request denied');},
            loading: () => ({ready: Promise.resolve(), destroy: () => {destroyed = true;}}),
        });
    } catch (error) {rejected = String(error).includes('Power request denied');}
    assert(destroyed && rejected, 'Failed power request dismisses loading and preserves the error');
    print('PASS: power loading animation, paint ordering, policy authentication and failure cleanup (mock power requests only)');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
