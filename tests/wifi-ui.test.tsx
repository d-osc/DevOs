import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, createRoot, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {WifiSettings} from '../src/apps/org.devos.settings/wifi-view.js';
import type {WifiControls, WifiNetwork, WifiState} from '../src/apps/org.devos.settings/wifi.js';

Gtk.init(null);
const theme = new Gtk.CssProvider();
theme.load_from_data(new TextEncoder().encode(new TextDecoder().decode(
    GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function widgets(widget: Gtk.Widget): Gtk.Widget[] {
    return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];
}
const wait = (ms: number) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
const net = (ssid: string, signal: number, extra: Partial<WifiNetwork> = {}): WifiNetwork =>
    ({ssid, signal, profile: '', adapter: 'wlan0', interfaceId: 'wlan0', secure: true, security: 'psk', connected: false, connectable: true, ...extra});
const base: WifiState = {networks: [], busy: false, error: '', message: '', accessDenied: false, wirelessEnabled: true};
const controls = (state: WifiState): WifiControls => ({state, subscribe: () => () => {}, async refresh() {}, async connect() {}, async setEnabled() {}, async disconnect() {}, async openWindowsSettings() {}});
const list = [net('Home Fiber 5G', 82, {connected: true, profile: 'Home Fiber 5G'}), net('Cafe Guest', 64, {secure: false, security: 'open'}),
    net('Neighbour_2.4', 38, {profile: 'Neighbour_2.4'}), net('DevOs lab', 91), net('xfinitywifi', 22)];
async function verify() {
    const dir = GLib.getenv('DEV_OS_WIFI_SCREENSHOT_DIR');
    const container = new Gtk.Box(), root = createRoot(container);
    const preview = new Gtk.OffscreenWindow(); preview.name = 'settings'; preview.set_size_request(760, 820); preview.add(container); preview.show_all();
    const find = (id: string) => widgets(container).find(widget => widget.name === id);
    const shoot = async (name: string, state: WifiState, check: () => void, props: {native?: boolean} = {}) => {
        root.render(<WifiSettings key={name} controls={controls(state)} native={props.native ?? true} />); await wait(250); check();
        if (dir) preview.get_pixbuf()!.savev(`${dir}/wifi-${name}.png`, 'png', [], []);
    };
    try {
        await shoot('connected', {...base, networks: list}, () => {
            assert(find('wifi-radio') && find('wifi-disconnect') && find('wifi-search'), 'Connected page keeps its controls');
            assert(widgets(container).some(w => w instanceof Gtk.Button && w.get_label() === 'Connect'), 'Rows keep Connect actions');
        });
        await shoot('scanning', {...base, busy: true, networks: []}, () => assert((find('wifi-empty') as Gtk.Label).get_text() === 'Looking for networks…', 'Scanning state'));
        await shoot('disabled', {...base, wirelessEnabled: false}, () => assert(find('wifi-radio') && !(find('wifi-radio') as Gtk.Switch).get_active(), 'Disabled radio is off'));
        await shoot('error', {...base, networks: list.slice(1), error: 'Could not connect to Cafe Guest.'}, () => assert(find('wifi-error'), 'Error notice shown'));
        await shoot('empty', base, () => assert(find('wifi-empty'), 'Empty state shown'));
        root.render(<WifiSettings key="join" controls={controls({...base, networks: list})} native />); await wait(150);
        (widgets(container).filter(w => w instanceof Gtk.Button && w.get_label() === 'Connect')[2] as Gtk.Button).emit('clicked'); await wait(250);
        assert(find('wifi-password'), 'Password prompt shown');
        if (dir) preview.get_pixbuf()!.savev(`${dir}/wifi-password.png`, 'png', [], []);
        print('PASS: Wi-Fi UI states render (connected, scanning, disabled, error, empty, password)');
    } finally { root.unmount(); preview.destroy(); }
}
const loop = new GLib.MainLoop(null, false);
let failed: unknown;
void verify().catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) throw failed;
