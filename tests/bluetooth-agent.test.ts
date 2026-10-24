import {Gio, GLib} from '@dev-os/core';
import {BluetoothAgent, type PairPrompt} from '../extensions/org.devos.settings/bluetooth-agent.js';
const bus = Gio.DBus.session, device = '/org/bluez/hci0/dev_TEST';
const xml = '<node><interface name="org.bluez.AgentManager1"><method name="RegisterAgent"><arg type="o" direction="in"/><arg type="s" direction="in"/></method><method name="UnregisterAgent"><arg type="o" direction="in"/></method></interface></node>';
const deviceXml = '<node><interface name="org.bluez.Device1"><method name="Pair"/><method name="CancelPairing"/></interface></node>';
let path = '', sender = '', invocation: Gio.DBusMethodInvocation | null = null, confirmations = 0, rejected = false;
let prompt: PairPrompt | null = null;
const agent = new BluetoothAgent(value => {prompt = value;}, bus);
function assert(value: unknown, message: string) {if (!value) throw new Error(message);}
const manager = Gio.DBusExportedObject.wrapJSObject(xml, {
    RegisterAgentAsync: ([p, capability]: [string, string], inv: Gio.DBusMethodInvocation) => {assert(capability === 'KeyboardDisplay', 'Interactive agent capability'); path = p; sender = inv.get_sender() || ''; inv.return_value(null);},
    UnregisterAgent: () => {path = '';},
}); manager.export(bus, '/org/bluez');
const accessory = Gio.DBusExportedObject.wrapJSObject(deviceXml, {
    PairAsync: (_args: unknown[], inv: Gio.DBusMethodInvocation) => {
        invocation = inv;
        bus.call(sender, path, 'org.bluez.Agent1', 'RequestConfirmation', new GLib.Variant('(ou)', [device, 123456]), null, Gio.DBusCallFlags.NONE, 3000, null, (connection, result) => {
            try {connection!.call_finish(result); confirmations++; invocation?.return_value(null);} catch {rejected = true; invocation?.return_dbus_error('org.bluez.Error.AuthenticationRejected', 'Declined');} invocation = null;
        });
    },
    CancelPairing: () => {},
}); accessory.export(bus, device);
const idle = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    let result = agent.pair(device); for (let i = 0; i < 50 && !prompt; i++) await idle();
    assert(prompt?.kind === 'confirm' && prompt.code === '123456', 'Confirmation shows actual BlueZ passkey');
    assert(confirmations === 0, 'Pairing waits for explicit confirmation'); agent.respond(true); await result;
    assert(confirmations === 1 && !prompt && !path, 'Accepted pairing unregisters agent');
    result = agent.pair(device); let caught = false; const done = result.catch(() => {caught = true;});
    for (let i = 0; i < 50 && !prompt; i++) await idle(); agent.respond(false); await done;
    assert(rejected && caught && !prompt && !path, 'Declined pairing rejects and cleans up');
    print('PASS: Native Bluetooth agent registers, waits for confirmation, accepts/rejects and unregisters');
}
const loop = new GLib.MainLoop(null, false); let failure: unknown;
const owner = Gio.bus_own_name_on_connection(bus, 'org.bluez', Gio.BusNameOwnerFlags.NONE, () => {void verify().catch(error => {failure = error;}).finally(() => loop.quit());}, () => {failure = new Error('Test bus name unavailable'); loop.quit();});
loop.run(); Gio.bus_unown_name(owner); agent.cancel(); manager.unexport(); accessory.unexport(); if (failure) throw failure;

