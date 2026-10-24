import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, createRoot, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {BluetoothDevicesSettings} from '../extensions/org.devos.settings/bluetooth-view.js';
import type {BluetoothControls, BluetoothState} from '../extensions/org.devos.settings/bluetooth.js';

Gtk.init(null);
const theme = new Gtk.CssProvider();
theme.load_from_data(new TextEncoder().encode(new TextDecoder().decode(
    GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function widgets(widget: Gtk.Widget): Gtk.Widget[] {
    return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];
}
function idle(): Promise<void> {
    return new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { resolve(); return GLib.SOURCE_REMOVE; }));
}
async function verify() {
    const state: BluetoothState = {host: 'Linux', busy: false, error: '', bluetoothError: '', usb: [], inputs: [],
        adapters: [{id: '/org/bluez/hci0', name: 'USB Bluetooth', powered: true}],
        devices: [{id: '/org/bluez/hci0/dev_AA', adapter: '/org/bluez/hci0', name: 'Test headphones', address: '', icon: 'audio-headphones', paired: true, connected: false}]};
    const actions: string[] = [];
    const controls: BluetoothControls = {state, subscribe: () => () => {},
        refresh: async scan => { actions.push(scan ? 'scan' : 'refresh'); },
        power: async () => { actions.push('power'); },
        device: async action => { actions.push(action); },
        openSettings: async page => { actions.push(`settings:${page}`); }, pair: async device => {actions.push(`pair:${device.id}`);}, respond: (accept, code) => {actions.push(`confirm:${accept}:${code}`);}, cancelPair: () => {actions.push('cancel-pair');}};
    const container = new Gtk.Box(), root = createRoot(container);
    const preview = new Gtk.OffscreenWindow();
    preview.name = 'settings'; preview.set_size_request(760, 900); preview.add(container);
    try {
        root.render(<BluetoothDevicesSettings controls={controls} navigate={page => actions.push(`native:${page}`)} />); await idle();
        const find = (id: string) => widgets(container).find(widget => widget.name === id);
        const button = (label: string) => widgets(container).find(widget => widget instanceof Gtk.Button && widget.get_label() === label) as Gtk.Button;
        assert(find('bluetooth-status') instanceof Gtk.Label, 'Bluetooth status is rendered');
        assert((find('bluetooth-scan') as Gtk.Button).get_sensitive(), 'A powered adapter enables scanning');
        (find('bluetooth-scan') as Gtk.Button).emit('clicked');
        button('Connect').emit('clicked');
        button('Forget…').emit('clicked'); await idle();
        assert(!actions.includes('forget'), 'Forget does not run before confirmation');
        button('Confirm forget').emit('clicked'); await idle();
        assert(actions.includes('scan') && actions.includes('connect') && actions.includes('forget'), 'Bluetooth actions reach the controller');
        (find('devices-category-mouse') as Gtk.Button).emit('clicked');
        assert(actions.includes('native:mouse'), 'Device category opens its own settings panel');
        root.render(<BluetoothDevicesSettings key="add" adding controls={{...controls, state:{...state, devices: state.devices.map(device => ({...device, paired:false}))}}}/>); await idle();
        button('Pair…').emit('clicked'); assert(actions.some(action => action.startsWith('pair:')), 'Pair uses native controller');
        assert(!find('devices-category-mouse'), 'Add-device page focuses on Bluetooth pairing');
        root.render(<BluetoothDevicesSettings key="confirm" adding controls={{...controls, state:{...state, busy:true, pairing:'Test headphones', prompt:{kind:'confirm', device:state.devices[0].id, code:'123456'}}}}/>); await idle();
        assert(!actions.some(action => action.startsWith('confirm:')), 'Showing pairing code does not accept it');
        (find('bluetooth-pair-confirm') as Gtk.Button).emit('clicked'); assert(actions.includes('confirm:true:'), 'Explicit confirmation reaches agent');
        (find('bluetooth-pair-cancel') as Gtk.Button).emit('clicked'); assert(actions.includes('cancel-pair'), 'Cancel reaches native agent');
        root.render(<BluetoothDevicesSettings key="wsl" controls={{...controls, state: {...state, host: 'Windows', adapters: [], devices: []}}} />); await idle();
        assert(find('bluetooth-wsl-notice'), 'WSL explains host ownership of hidden radios');
        assert(!(find('bluetooth-scan') as Gtk.Button).get_sensitive(), 'No adapter disables scanning');
        assert(!(widgets(container).some(widget => widget.name === 'bluetooth-power-hci0')), 'No fabricated power switch');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (screenshot) {
            preview.show_all();
            await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => { resolve(); return GLib.SOURCE_REMOVE; }));
            const pixels = preview.get_pixbuf();
            assert(pixels, 'Settings preview rendered');
            pixels!.savev(screenshot, 'png', [], []);
        }
        print('PASS: Bluetooth UI actions, forget confirmation, host settings and missing WSL adapter');
    } finally { root.unmount(); preview.destroy(); }
}
const loop = new GLib.MainLoop(null, false);
let failed: unknown;
void verify().catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) throw failed;
