import json
import unittest
from bridge_support import BridgeFixture, literal

ADAPTER='/org/bluez/hci0'; DEVICE=ADAPTER+'/dev_AA_BB_CC_DD_EE_FF'
OBJECTS={ADAPTER:{'org.bluez.Adapter1':{'Alias':'Radio','Powered':True}},DEVICE:{'org.bluez.Device1':{'Alias':'หูฟัง "Test"','Adapter':ADAPTER,'Paired':True,'Connected':False}}}

class BluetoothTests(unittest.TestCase):
    def setUp(self):
        self.bridge=BridgeFixture('bin/dev-os-devices-linux'); self.addCleanup(self.bridge.close)
        self.log=self.bridge.log('busCall','(arguments: Vec<str>): bool')
        self.bridge.replace('objects',f'fn objects(): json.Value {{ return {literal(OBJECTS)} }}')
        self.bridge.replace_text('time.sleep_ms(3000)', 'time.sleep_ms(1)')

    def act(self, request, objects=OBJECTS):
        return self.bridge.value(f'bridge.act({literal(request)}, {literal(objects)})')

    def test_snapshot_preserves_unicode_and_connection_state(self):
        self.assertTrue(self.bridge.value(f'bridge.adaptersOf({literal(OBJECTS)})')[0]['powered'])
        device=self.bridge.value(f'bridge.devicesOf({literal(OBJECTS)})')[0]
        self.assertEqual(device['name'],'หูฟัง "Test"'); self.assertTrue(device['paired']); self.assertFalse(device['connected'])

    def test_busctl_wire_reply_unwraps_return_tuple_and_variants(self):
        bridge=BridgeFixture('bin/dev-os-devices-linux'); self.addCleanup(bridge.close)
        tree={path:{interface:{key:{'type':'b' if isinstance(value,bool) else 's','data':value} for key,value in props.items()} for interface,props in interfaces.items()} for path,interfaces in OBJECTS.items()}
        reply=json.dumps({'type':'a{oa{sa{sv}}}','data':[tree]},ensure_ascii=False)
        bridge.replace('capture',f'fn capture(command: str): str {{ return {json.dumps(reply,ensure_ascii=False)} }}')
        device=bridge.value('bridge.devicesOf(bridge.objects())')[0]
        self.assertEqual(device['name'],'หูฟัง "Test"'); self.assertTrue(device['paired']); self.assertFalse(device['connected'])

    def test_scan_releases_discovery_after_read_failure(self):
        self.bridge.replace('objects','fn objects(): json.Value { result.raise("Radio unplugged"); return {} }')
        self.assertIn('Radio unplugged',self.bridge.invoke(f'return bridge.act({{action:"scan"}}, {literal(OBJECTS)})')['error'])
        self.assertEqual([json.loads(line)[-1] for line in self.log.read_text().splitlines()],['StartDiscovery','StopDiscovery'])

    def test_scan_needs_powered_adapter(self):
        self.assertIn('Turn on',self.act({'action':'scan'}, {})['error']); self.assertFalse(self.log.exists())

    def test_unknown_and_unpaired_device_rejected(self):
        self.assertIn('error',self.act({'action':'connect','id':'/unrelated/object'}))
        self.assertIn('Pair this device',self.act({'action':'connect','id':DEVICE},{DEVICE:{'org.bluez.Device1':{}}})['error'])
        self.assertFalse(self.log.exists())

    def test_connect_and_forget_target_actual_adapter(self):
        self.act({'action':'connect','id':DEVICE}); self.act({'action':'forget','id':DEVICE})
        calls=[json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual(calls[0],['call','org.bluez',DEVICE,'org.bluez.Device1','Connect'])
        self.assertEqual(calls[1],['call','org.bluez',ADAPTER,'org.bluez.Adapter1','RemoveDevice','o',DEVICE])

    def test_settings_rejects_arbitrary_commands(self):
        result=self.bridge.cli({'action':'settings','page':'; reboot'})
        self.assertEqual(result.returncode,1); self.assertIn('Unknown',json.loads(result.stdout)['error'])

    def test_sysfs_inventory_and_offline_bluetooth(self):
        base=self.bridge.root/'sys'; base.mkdir()
        self.bridge.replace_text('/sys/bus/usb/devices',str(base))
        self.assertEqual(self.bridge.value('bridge.usbInventory()'),[])
        usb=base/'1-1'; usb.mkdir(); (usb/'product').write_text('USB Keyboard')
        self.assertEqual(self.bridge.value('bridge.usbInventory()')[0]['name'],'USB Keyboard')
        self.bridge.replace('objects','fn objects(): json.Value { return json.null_value() }')
        result=self.bridge.cli({'action':'get'})
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        state=json.loads(result.stdout)['state']; self.assertEqual(state['adapters'],[])
        self.assertIn('unavailable',state['bluetoothError']); self.assertEqual(state['usb'][0]['name'],'USB Keyboard')

if __name__=='__main__': unittest.main()
