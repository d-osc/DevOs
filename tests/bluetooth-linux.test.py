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
        self.bridge.replace_text('time.sleep_ms(8000)', 'time.sleep_ms(1)')

    def act(self, request, objects=OBJECTS):
        return self.bridge.value(f'bridge.act({literal(request)}, {literal(objects)})')

    def test_snapshot_preserves_unicode_and_connection_state(self):
        self.assertTrue(self.bridge.value(f'bridge.adaptersOf({literal(OBJECTS)})')[0]['powered'])
        device=self.bridge.value(f'bridge.devicesOf({literal(OBJECTS)})')[0]
        self.assertEqual(device['name'],'หูฟัง "Test"'); self.assertTrue(device['paired']); self.assertFalse(device['connected'])

    def test_cli_envelope_for_settings_refresh_and_scan(self):
        for action in ['get','scan']:
            reply=self.bridge.cli({'action':action})
            self.assertEqual(reply.returncode,0,reply.stdout+reply.stderr)
            value=json.loads(reply.stdout)
            self.assertTrue(value['ok']); self.assertEqual(value['state']['adapters'][0]['id'],ADAPTER)
            self.assertEqual(value['state']['devices'][0]['id'],DEVICE)

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

    # `bluetoothctl devices` of the physical UX3407NA boot ed68b0bd (build/live-usb/hardware-logs-20261024-1405).
    REAL_SCAN='''Device 6A:8C:BB:AA:06:0D HSJ-LOCK
Device 51:A0:9F:2B:ED:D5 51-A0-9F-2B-ED-D5
Device 5C:44:0C:E3:00:78 5C-44-0C-E3-00-78
Device 34:55:E5:03:E2:C4 Washer
Device 70:4C:26:9C:DC:13 HOCO W56
Device 7D:25:DF:46:98:F5 7D-25-DF-46-98-F5'''

    def test_real_scan_lists_every_device_with_named_ones_first_and_unnamed_labelled(self):
        tree={ADAPTER:{'org.bluez.Adapter1':{'Alias':'devos','Powered':True}}}
        for line in self.REAL_SCAN.splitlines():
            _,address,alias=line.split(' ',2)
            props={'Alias':alias,'Address':address,'Adapter':ADAPTER,'Paired':False,'Connected':False,'Icon':'bluetooth'}
            if alias!=address.replace(':','-'): props['Name']=alias
            tree[ADAPTER+'/dev_'+address.replace(':','_')]={'org.bluez.Device1':props}
        devices=self.bridge.value(f'bridge.devicesOf({literal(tree)})')
        self.assertEqual(len(devices),6)
        self.assertEqual(sorted(d['name'] for d in devices[:3]),['HOCO W56','HSJ-LOCK','Washer'])
        self.assertTrue(all(d['named'] for d in devices[:3]))
        unnamed=devices[3:]
        self.assertTrue(all(not d['named'] and d['name'].startswith('Unknown device · ') for d in unnamed))
        self.assertIn('Unknown device · 51:A0:9F:2B:ED:D5',[d['name'] for d in unnamed])

    def test_scan_joins_a_discovery_already_in_progress_and_leaves_it_running(self):
        self.bridge.replace('busCall','fn busCall(args: Vec<str>): bool { return !strings.equal(args[args.len() - 1], "StartDiscovery") }')
        self.bridge.replace('discoveryRunning','fn discoveryRunning(adapter: str): bool { return true }')
        result=self.act({'action':'scan'})
        self.assertNotIn('error',result); self.assertIn(DEVICE,result)

    def test_scan_reports_failure_when_start_fails_and_nothing_is_scanning(self):
        self.bridge.replace('busCall','fn busCall(args: Vec<str>): bool { return false }')
        self.bridge.replace('discoveryRunning','fn discoveryRunning(adapter: str): bool { return false }')
        self.assertIn('scan failed',self.act({'action':'scan'})['error'])

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
