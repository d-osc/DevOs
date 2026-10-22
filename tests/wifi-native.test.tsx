import {React, Gtk, GLib, createRoot} from '@dev-os/core';
import {WifiSettings} from '../extensions/org.devos.settings/wifi-view.js';
import type {WifiControls} from '../extensions/org.devos.settings/wifi.js';
Gtk.init(null);
const loop = new GLib.MainLoop(null, false);
const window = new Gtk.Window(), box = new Gtk.Box(); window.add(box);
const root = createRoot(box);
let failure: unknown, received = '', outside = 0, radio: boolean | null = null;
const controls: WifiControls = {
    state: {networks: [{ssid: 'DevOs test network', interfaceId: 'test', adapter: 'wlan0', profile: '', signal: 90, secure: true, security: 'psk', connected: false, connectable: true}], busy: false, error: '', message: '', accessDenied: false, wirelessEnabled: true},
    subscribe: () => () => {}, async refresh() {}, async connect(_network, password) { received = password ?? ''; },
    async setEnabled(value) { radio = value; }, async openWindowsSettings() { outside++; },
};
const idle = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => { resolve(); return GLib.SOURCE_REMOVE; }));
function widgets(widget: Gtk.Widget): Gtk.Widget[] { return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])]; }
function assert(value: unknown, reason: string) { if (!value) throw new Error(reason); }
async function run() {
    root.render(<WifiSettings controls={controls} native />); window.show_all(); await idle();
    assert(!widgets(window).some(widget => widget.name === 'wifi-windows-settings'), 'Native page must not open external settings');
    (widgets(window).find(widget => widget instanceof Gtk.Button && widget.get_label() === 'Connect') as Gtk.Button).emit('clicked'); await idle();
    const password = widgets(window).find(widget => widget.name === 'wifi-password') as Gtk.Entry;
    assert(password && !password.get_visibility(), 'DevOs password input must be masked');
    password.set_text('test password'); await idle();
    (widgets(window).find(widget => widget.name === 'wifi-join-confirm') as Gtk.Button).emit('clicked'); await idle();
    assert(received === 'test password' && outside === 0, 'Connect must stay in DevOs with the provided password');
    assert(!widgets(window).some(widget => widget.name === 'wifi-password'), 'Password form is cleared after success');
    (widgets(window).find(widget => widget.name === 'wifi-radio') as Gtk.Switch).set_active(false); await idle();
    assert(radio === false, 'DevOs radio switch reaches the backend');
    print('PASS: native DevOs Wi-Fi password form, masked input, connection, clearing, radio and no external settings');
}
void run().catch(error => { failure = error; }).finally(() => loop.quit());
loop.run(); root.unmount(); window.destroy(); if (failure) throw failure;
