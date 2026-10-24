import json
import os
import unittest
from bridge_support import BridgeFixture

class SystemTests(unittest.TestCase):
    def setUp(self):
        self.bridge = BridgeFixture('bin/dev-os-system'); self.addCleanup(self.bridge.close)

    def test_fields_and_inventory(self):
        self.assertEqual(self.bridge.value('bridge.fieldOf("MemTotal: 1234 kB\\nMemFree: 200 kB", "MemTotal", ":")'), '1234 kB')
        self.assertEqual(self.bridge.value('bridge.fieldOf("PRETTY_NAME=\\"DevOs\\"", "PRETTY_NAME", "=")'), 'DevOs')
        state = self.bridge.value('bridge.inventory()')
        self.assertGreater(state['memory'], 0); self.assertGreater(state['processors'], 0)
        self.assertTrue(state['kernel'] and state['storage'])
        self.assertIn('machineId', state['hardware'])
        self.assertIn('biosVersion', state['hardware'])
        self.assertTrue(all(disk['total'] >= disk['used'] >= 0 for disk in state['storage']))

    def test_hardware_optional_values_and_placeholders(self):
        path = self.bridge.root / 'hardware-value'
        for text, expected in [('ASUSTeK COMPUTER INC.\n', 'ASUSTeK COMPUTER INC.'), ('To Be Filled By O.E.M.', ''), ('00000000-0000-0000-0000-000000000000', '')]:
            path.write_text(text)
            self.assertEqual(self.bridge.value(f'bridge.hardwareText({json.dumps(str(path))})'), expected)
        self.assertEqual(self.bridge.value(f'bridge.hardwareText({json.dumps(str(path)+"-missing")})'), '')

    def test_arm_hardware_falls_back_to_device_tree_and_soc(self):
        self.bridge.replace('capture', 'fn capture(command: str): str { return "Architecture: aarch64\\nVendor ID: ARM\\nSocket(s): 1\\nCore(s) per socket: 18\\nThread(s) per core: 1" }')
        self.bridge.replace('hardwareText', 'fn hardwareText(path: str): str { if strings.equal(path, "/sys/firmware/devicetree/base/model") { return "ASUS Zenbook A14 UX3407NA" }; if strings.equal(path, "/sys/devices/soc0/machine") { return "Qualcomm Glymur" }; return "" }')
        value = self.bridge.value('bridge.hardwareInfo("")')
        self.assertEqual(value['model'], 'ASUS Zenbook A14 UX3407NA')
        self.assertEqual(value['cpuName'], 'Qualcomm Glymur')
        self.assertEqual(value['coresPerSocket'], '18')
        self.assertEqual(value['serial'], '')

    def test_battery_values(self):
        base = self.bridge.root / 'power'; base.mkdir()
        battery = base / 'BAT0'; battery.mkdir()
        (battery/'type').write_text('Battery'); (battery/'status').write_text('Charging')
        self.bridge.replace_text('/sys/class/power_supply', str(base))
        for value, expected in [('45',45), ('invalid',None), ('130',100)]:
            (battery/'capacity').write_text(value)
            self.assertEqual(self.bridge.value('bridge.batteries()'), [{'name':'BAT0','status':'Charging','percent':expected,'health':None,'cycles':None,'minutes':None}])
        for name, value in {'energy_full':'40000000','energy_full_design':'50000000','energy_now':'20000000','power_now':'10000000','cycle_count':'123'}.items():
            (battery/name).write_text(value)
        value=self.bridge.value('bridge.batteries()')[0]
        self.assertEqual((value['health'],value['cycles'],value['minutes']),(80,123,120))
        (battery/'status').write_text('Discharging')
        self.assertEqual(self.bridge.value('bridge.batteries()')[0]['minutes'],120)
        (battery/'power_now').write_text('0')
        self.assertIsNone(self.bridge.value('bridge.batteries()')[0]['minutes'])

    def test_battery_percent_falls_back_to_energy_counters(self):
        # qcom_battmgr returns ENODATA for capacity until the PMIC firmware reports a percentage.
        base = self.bridge.root / 'power-counters'; base.mkdir()
        battery = base / 'qcom-battmgr-bat'; battery.mkdir()
        (battery/'type').write_text('Battery'); (battery/'status').write_text('Charging')
        self.bridge.replace_text('/sys/class/power_supply', str(base))
        self.assertIsNone(self.bridge.value('bridge.batteries()')[0]['percent'])
        (battery/'energy_now').write_text('20000000'); (battery/'energy_full').write_text('40000000')
        self.assertEqual(self.bridge.value('bridge.batteries()')[0]['percent'], 50)
        (battery/'energy_now').unlink(); (battery/'energy_full').unlink()
        (battery/'charge_now').write_text('1000'); (battery/'charge_full').write_text('4000')
        self.assertEqual(self.bridge.value('bridge.batteries()')[0]['percent'], 25)

    def test_safe_settings_routes_and_missing_tool(self):
        log = self.bridge.root / 'capture'
        self.bridge.replace('capture', f'fn capture(command: str): str {{ fs.writeFileSync({json.dumps(str(log))}, command); return "" }}')
        self.bridge.replace('isWsl', 'fn isWsl(): bool { return true }')
        self.assertEqual(self.bridge.value('bridge.openPage("display", true)'), '')
        self.assertIn("Start-Process 'ms-settings:display'", log.read_text())
        log.unlink()
        for page in ('display; echo bad', 'unknown'):
            self.assertTrue(self.bridge.value(f'bridge.openPage({json.dumps(page)}, true)')); self.assertFalse(log.exists())
        self.bridge.replace('isWsl', 'fn isWsl(): bool { return false }')
        self.assertTrue(self.bridge.value('bridge.openPage("power", true)')); self.assertFalse(log.exists())
        self.bridge.replace('toolAvailable', 'fn toolAvailable(tool: str): bool { return false }')
        self.assertIn('DevOs Settings', self.bridge.value('bridge.openPage("display", false)'))

    def test_unsupported_profile_rejected_before_mutation(self):
        self.assertTrue(self.bridge.value('bridge.selectProfile("unsupported-profile")'))

    def test_power_profile_dbus_signature(self):
        folder=self.bridge.root/'commands'; folder.mkdir(); log=self.bridge.root/'profile.args'
        command=folder/'busctl'; command.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" > "{log}"\n'); command.chmod(0o700)
        props={'ActiveProfile':{'type':'s','data':'balanced'},'Profiles':{'type':'aa{sv}','data':[{'Profile':{'type':'s','data':'balanced'}},{'Profile':{'type':'s','data':'power-saver'}}]}}
        self.bridge.replace('powerProperties',f'fn powerProperties(name: str, path: str): json.Value {{ return json.parse({json.dumps(json.dumps(props))}) }}')
        self.assertEqual(self.bridge.value('bridge.selectProfile("power-saver")', {'PATH':str(folder)+':'+os.environ['PATH']}), '')
        self.assertEqual(log.read_text().splitlines()[-6:], ['Set','ssv','org.freedesktop.UPower.PowerProfiles','ActiveProfile','s','power-saver'])
        self.assertEqual(log.read_text().splitlines()[2:4], ['org.freedesktop.UPower.PowerProfiles','/org/freedesktop/UPower/PowerProfiles'])

    def test_typed_power_inventory_and_service_fallback(self):
        props={'ActiveProfile':{'type':'s','data':'balanced'},'Profiles':{'type':'aa{sv}','data':[{'Profile':{'type':'s','data':'balanced'}},{'Profile':{'type':'s','data':'power-saver'}}]},'PerformanceDegraded':{'type':'s','data':'high-operating-temperature'}}
        log=self.bridge.root/'bus.query'
        raw=json.dumps({'type':'a{sv}','data':[props]})
        self.bridge.replace('capture',f'fn capture(command: str): str {{ fs.writeFileSync({json.dumps(str(log))}, command); return {json.dumps(raw)} }}')
        state=self.bridge.value('bridge.powerProfileState()')
        self.assertEqual(state['profiles'],['balanced','power-saver'])
        self.assertEqual(state['active'],'balanced')
        self.assertEqual(state['degraded'],'high-operating-temperature')
        self.assertIn('call org.freedesktop.UPower.PowerProfiles /org/freedesktop/UPower/PowerProfiles',log.read_text())
        self.bridge.replace('capture',f'fn capture(command: str): str {{ if strings.contains(command, "call org.freedesktop.UPower.PowerProfiles") {{ return "" }} fs.writeFileSync({json.dumps(str(log))}, command); return {json.dumps(raw)} }}')
        self.assertTrue(self.bridge.value('bridge.powerProfileState()')['available'])
        self.assertIn('call net.hadess.PowerProfiles /net/hadess/PowerProfiles',log.read_text())

if __name__ == '__main__': unittest.main()
