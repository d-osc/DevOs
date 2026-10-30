#!/usr/bin/env python3
"""A stand-in for BlueZ on the session bus, for tests/bluetooth-pairing.test.dev only.

It owns org.bluez, offers AgentManager1 at /org/bluez and one Device1 at /org/bluez/hci0/dev_AA_BB_CC_DD_EE_01. Device1.Pair asks the registered
agent what FAKE_SCENARIO says (confirm, pin, passkey, authorize, display or none) and succeeds only if the agent accepts. Everything it sees is
appended to FAKE_LOG, one line each. Run it inside `dbus-run-session`.
"""
import os
import sys
from gi.repository import Gio, GLib

DEVICE = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_01'
OTHER = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_99'
LOG = os.environ['FAKE_LOG']
SCENARIO = os.environ.get('FAKE_SCENARIO', 'confirm')
agent = {'sender': None, 'path': None}
pairing = {'invocation': None}

def log(line):
    with open(LOG, 'a') as handle:
        handle.write(line + '\n')

MANAGER = Gio.DBusNodeInfo.new_for_xml('''<node><interface name="org.bluez.AgentManager1">
<method name="RegisterAgent"><arg type="o" direction="in"/><arg type="s" direction="in"/></method>
<method name="UnregisterAgent"><arg type="o" direction="in"/></method></interface></node>''')
DEVICE_XML = Gio.DBusNodeInfo.new_for_xml('''<node><interface name="org.bluez.Device1">
<method name="Pair"/><method name="CancelPairing"/></interface></node>''')

def ask(method, params, signature, done):
    def finished(connection, result):
        try:
            reply = connection.call_finish(result)
            log('agent replied %s %s' % (method, reply.print_(False)))
            done(True)
        except GLib.Error as error:
            log('agent refused %s %s' % (method, error.message))
            done(False)
    bus.call(agent['sender'], agent['path'], 'org.bluez.Agent1', method, params, None, Gio.DBusCallFlags.NONE, 30000, None, finished)

def manager_call(connection, sender, path, interface, method, parameters, invocation):
    if method == 'RegisterAgent':
        agent['path'], capability = parameters.unpack()
        agent['sender'] = sender
        log('register %s' % capability)
    else:
        log('unregister')
        agent['path'] = None
    invocation.return_value(None)

def device_call(connection, sender, path, interface, method, parameters, invocation):
    if method == 'CancelPairing':
        log('cancel')
        if pairing['invocation']:
            pairing['invocation'].return_dbus_error('org.bluez.Error.AuthenticationCanceled', 'Authentication Canceled')
            pairing['invocation'] = None
        invocation.return_value(None)
        return
    log('pair')
    if agent['path'] is None:
        invocation.return_dbus_error('org.bluez.Error.Failed', 'No agent')
        return
    pairing['invocation'] = invocation
    def finish(ok):
        current = pairing['invocation']
        if current is None:
            return
        pairing['invocation'] = None
        if ok:
            current.return_value(None)
        else:
            current.return_dbus_error('org.bluez.Error.AuthenticationFailed', 'Authentication Failed')
    if SCENARIO == 'confirm':
        ask('RequestConfirmation', GLib.Variant('(ou)', (DEVICE, 123456)), '(ou)', finish)
    elif SCENARIO == 'pin':
        ask('RequestPinCode', GLib.Variant('(o)', (DEVICE,)), '(o)', finish)
    elif SCENARIO == 'passkey':
        ask('RequestPasskey', GLib.Variant('(o)', (DEVICE,)), '(o)', finish)
    elif SCENARIO == 'authorize':
        ask('RequestAuthorization', GLib.Variant('(o)', (DEVICE,)), '(o)', finish)
    elif SCENARIO == 'other':
        # A request about another device must be rejected by the agent, and then pairing fails.
        ask('RequestConfirmation', GLib.Variant('(ou)', (OTHER, 1)), '(ou)', finish)
    elif SCENARIO == 'display':
        def after(ok):
            GLib.timeout_add(1500, lambda: (finish(True), False)[1])
        ask('DisplayPasskey', GLib.Variant('(ouq)', (DEVICE, 654321, 2)), '(ouq)', after)
    else:
        finish(True)

def on_bus(connection, name):
    global bus
    bus = connection
    connection.register_object('/org/bluez', MANAGER.interfaces[0], manager_call, None, None)
    connection.register_object(DEVICE, DEVICE_XML.interfaces[0], device_call, None, None)

def on_acquired(connection, name):
    log('ready')
    open(os.environ['FAKE_READY'], 'w').close()

bus = None
Gio.bus_own_name(Gio.BusType.SESSION, 'org.bluez', Gio.BusNameOwnerFlags.NONE, on_bus, on_acquired, lambda c, n: sys.exit(1))
GLib.MainLoop().run()
