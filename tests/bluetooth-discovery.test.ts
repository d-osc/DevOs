import {Gio, GLib} from '@dev-os/core';
import {BluetoothDiscovery} from '../extensions/org.devos.settings/bluetooth-discovery.js';
function assert(value: unknown, message: string) {if (!value) throw new Error(message);}
async function verify() {
    const daemon = Gio.TestDBus.new(Gio.TestDBusFlags.NONE); daemon.up();
    const flags = Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION;
    const server = Gio.DBusConnection.new_for_address_sync(daemon.get_bus_address()!,flags,null,null);
    const client = Gio.DBusConnection.new_for_address_sync(daemon.get_bus_address()!,flags,null,null);
    server.call_sync('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','RequestName',new GLib.Variant('(su)',['org.bluez',0]),null,Gio.DBusCallFlags.NONE,1000,null);
    let owner = '', stopped = 0, started = 0;
    const object = Gio.DBusExportedObject.wrapJSObject('<node><interface name="org.bluez.Adapter1"><method name="StartDiscovery"/><method name="StopDiscovery"/></interface></node>',{
        StartDiscoveryAsync: (_args: unknown, invocation: Gio.DBusMethodInvocation) => {owner=invocation.get_sender() ?? ''; started++; invocation.return_value(null);},
        StopDiscoveryAsync: (_args: unknown, invocation: Gio.DBusMethodInvocation) => {assert(owner === invocation.get_sender(),'Stop belongs to the same connection');owner='';stopped++;invocation.return_value(null);},
    });
    object.export(server,'/org/bluez/hci0');
    const scanner = new BluetoothDiscovery(client,30);
    try {
        const result = await scanner.scan('/org/bluez/hci0',async () => {
            assert(owner === client.get_unique_name(), 'Discovery owner still connected while reading devices');
            assert(stopped === 0,'Discovery did not stop before the results were read'); return ['headphones'];
        });
        assert(result[0] === 'headphones' && stopped === 1,'Results read, then discovery released');
        try {await scanner.scan('/org/bluez/hci0',async () => {throw new Error('Read failed');});} catch { /* expected */ }
        assert(stopped === 2,'Read failure still releases discovery');
        const cancel = new BluetoothDiscovery(client,1000);
        const operation = cancel.scan('/org/bluez/hci0',async () => {throw new Error('Cancelled scan read devices');});
        GLib.timeout_add(GLib.PRIORITY_DEFAULT,30,() => {cancel.destroy();return GLib.SOURCE_REMOVE;});
        let cancelled = false; try {await operation;} catch {cancelled=true;}
        assert(cancelled && stopped === 3 && started === 3,'Closing settings cancels the wait and releases discovery');
        print('PASS: persistent BlueZ D-Bus ownership, results-before-stop, failure and cancellation cleanup (private service)');
    } finally {scanner.destroy();object.unexport();client.close_sync(null);server.close_sync(null);daemon.down();}
}
const loop = new GLib.MainLoop(null,false); let failed: unknown;
void verify().catch(error => {failed=error;}).finally(() => loop.quit());loop.run();if (failed) throw failed;
