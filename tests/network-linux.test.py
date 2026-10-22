"""NetworkManager integration against a private D-Bus service, never the host radio."""
import json
from pathlib import Path
import subprocess
import threading
import unittest
import uuid
from gi.repository import Gio, GLib
from devlang_support import run_source, use, run_bin

PROPERTIES = '''<node><interface name="org.freedesktop.DBus.Properties"><method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method><method name="Get"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method></interface></node>'''
NM = '''<node><interface name="org.freedesktop.NetworkManager"><method name="GetDevices"><arg type="ao" direction="out"/></method><method name="AddAndActivateConnection"><arg type="a{sa{sv}}" direction="in"/><arg type="o" direction="in"/><arg type="o" direction="in"/><arg type="o" direction="out"/><arg type="o" direction="out"/></method><method name="DeactivateConnection"><arg type="o" direction="in"/></method></interface></node>'''
WIRELESS = '''<node><interface name="org.freedesktop.NetworkManager.Device.Wireless"><method name="RequestScan"><arg type="a{sv}" direction="in"/></method></interface></node>'''
SETTINGS = '''<node><interface name="org.freedesktop.NetworkManager.Settings.Connection"><method name="GetSettings"><arg type="a{sa{sv}}" direction="out"/></method><method name="Delete"/></interface></node>'''
BASE = '/org/freedesktop/NetworkManager'
DEVICE, POINT, SAVED, ACTIVE = (BASE + suffix for suffix in ('/Devices/1', '/AccessPoint/1', '/Settings/1', '/ActiveConnection/1'))
SSID = 'Cafe: "ไทย"'
PROFILE = '11111111-1111-1111-1111-111111111111'
V = GLib.Variant

class NetworkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.daemon = subprocess.Popen(['dbus-daemon', '--session', '--nofork', '--print-address=1'], stdout=subprocess.PIPE, text=True)
        cls.address = cls.daemon.stdout.readline().strip()
        cls.bus = Gio.DBusConnection.new_for_address_sync(cls.address, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
        cls.bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName', V('(su)', ('org.freedesktop.NetworkManager', 0)), None, Gio.DBusCallFlags.NONE, -1, None)
        cls.registrations = []
        for path, xmls in ((BASE, [PROPERTIES, NM]), (DEVICE, [PROPERTIES, WIRELESS]), (POINT, [PROPERTIES]), (SAVED, [SETTINGS]), (ACTIVE, [PROPERTIES])):
            for xml in xmls:
                info = Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0]
                cls.registrations.append(cls.bus.register_object(path, info, cls.call, None, None))
        cls.loop = GLib.MainLoop()
        cls.worker = threading.Thread(target=cls.loop.run, daemon=True)
        cls.worker.start()
    @classmethod
    def tearDownClass(cls):
        cls.loop.quit()
        cls.worker.join(3)
        for registration in cls.registrations: cls.bus.unregister_object(registration)
        cls.bus.close_sync(None)
        cls.daemon.terminate()
        cls.daemon.wait(timeout=5)
        cls.daemon.stdout.close()
    def setUp(self):
        type(self).calls = []
        type(self).state = 2
        type(self).radio = True
        type(self).missing = False
    @classmethod
    def props(cls, path, interface):
        if path == BASE: return {'WirelessEnabled': V('b', cls.radio)}
        if path == DEVICE and interface.endswith('.Wireless'):
            return {'AccessPoints': V('ao', [POINT]), 'ActiveAccessPoint': V('o', POINT)}
        if path == DEVICE:
            return {'DeviceType': V('u', 2), 'Interface': V('s', 'wlan0'), 'AvailableConnections': V('ao', [SAVED])}
        if path == POINT:
            return {'Ssid': V('ay', SSID.encode()), 'Strength': V('y', 87), 'Flags': V('u', 1), 'WpaFlags': V('u', 0), 'RsnFlags': V('u', 0x100)}
        if path == ACTIVE: return {'State': V('u', cls.state)}
        return {}
    @classmethod
    def call(cls, connection, sender, path, interface, method, parameters, invocation):
        args = parameters.unpack()
        cls.calls.append((path, method, args))
        try:
            if method == 'GetAll': invocation.return_value(V('(a{sv})', (cls.props(path, args[0]),)))
            elif method == 'Get': invocation.return_value(V('(v)', (cls.props(path, args[0])[args[1]],)))
            elif method == 'GetDevices': invocation.return_value(V('(ao)', ([] if cls.missing else [DEVICE],)))
            elif method == 'GetSettings': invocation.return_value(V('(a{sa{sv}})', ({'802-11-wireless': {'ssid': V('ay', SSID.encode())}, 'connection': {'uuid': V('s', PROFILE)}},)))
            elif method == 'AddAndActivateConnection': invocation.return_value(V('(oo)', (SAVED, ACTIVE)))
            else: invocation.return_value(V('()', ()))
        except Exception as error: invocation.return_dbus_error('org.devos.Test.Error', str(error))
    def execute(self, request):
        source = use('network') + use('dbus') + 'use "std/json"\nuse "std/result"\nlet bus = dbus.open()\nlet outcome = result.attempt(fn(): json.Value { return network.execute(bus, json.parse(' + json.dumps(json.dumps(request)) + ')) })\ndbus.close(bus)\nif result.isErr(outcome) { print(json.stringify({ok: false, error: result.message(outcome)})) } else { print(json.stringify(result.unwrap(outcome))) }'
        return json.loads(run_source(source, ffi=True, env={'DBUS_SYSTEM_BUS_ADDRESS': self.address}))
    def test_scan_preserves_utf8_ssid_and_uuid5(self):
        result = self.execute({'action': 'scan'})
        self.assertTrue(result['ok'], result)
        point = result['networks'][0]
        self.assertEqual(point['ssid'], SSID)
        self.assertEqual(point['signal'], 87)
        self.assertEqual(point['profile'], PROFILE)
        self.assertEqual(point['interfaceId'], str(uuid.uuid5(uuid.NAMESPACE_OID, 'wlan0')))
        self.assertTrue(point['connected'] and point['secure'] and point['connectable'])
        self.assertIn('RequestScan', [call[1] for call in self.calls])
    def test_radio_disabled_and_missing_adapter_are_distinct(self):
        type(self).radio = False
        self.assertEqual(self.execute({'action': 'scan'}), {'ok': True, 'networks': [], 'wirelessEnabled': False})
        type(self).missing = True
        result = self.execute({'action': 'scan'})
        self.assertFalse(result['ok'])
        self.assertIn('No Linux Wi-Fi adapter', result['error'])
    def request(self, **kwargs):
        return {'action': 'connect', 'ssid': SSID, 'interfaceId': str(uuid.uuid5(uuid.NAMESPACE_OID, 'wlan0')), 'secure': True, 'security': 'psk', 'password': 'safe password', **kwargs}
    def test_native_activation_and_failed_connection_cleanup(self):
        for state in (2, 4):
            type(self).state = state
            type(self).calls = []
            result = self.execute(self.request())
            self.assertEqual(result['ok'], state == 2, result)
            settings, device, point = next(call[2] for call in self.calls if call[1] == 'AddAndActivateConnection')
            self.assertEqual(bytes(settings['802-11-wireless']['ssid']), SSID.encode())
            self.assertEqual(settings['802-11-wireless-security']['psk'], 'safe password')
            self.assertEqual(settings['802-11-wireless-security']['key-mgmt'], 'wpa-psk')
            self.assertEqual((device, point), (DEVICE, POINT))
            if state == 4: self.assertEqual([call[1] for call in self.calls[-2:]], ['DeactivateConnection', 'Delete'])
    def test_invalid_password_and_enterprise_are_rejected_before_activation(self):
        for value in (self.request(password='short'), self.request(security='enterprise')):
            result = self.execute(value)
            self.assertFalse(result['ok'])
        self.assertNotIn('AddAndActivateConnection', [call[1] for call in self.calls])
    def test_external_settings_and_invalid_profile_never_launch_commands(self):
        self.assertFalse(self.execute({'action': 'settings'})['ok'])
        self.assertFalse(self.execute(self.request(profile='; reboot'))['ok'])
    def test_non_utf8_names_and_open_security(self):
        source = use('network') + 'use "std/json"\nprint(network.ssidOf(json.parse("[67,97,102,101,255]")))\nprint(network.connectionSettings("Open", "", "open"))'
        output = run_source(source, ffi=True).splitlines()
        self.assertEqual(output[0], 'Cafe\ufffd')
        self.assertNotIn('802-11-wireless-security', output[1])
    def test_real_entry_loads_gio_and_preserves_json_protocol(self):
        result = run_bin('network-linux', {'action': 'scan'}, env={'DBUS_SYSTEM_BUS_ADDRESS': self.address})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['networks'][0]['ssid'], SSID)

if __name__ == '__main__': unittest.main()
