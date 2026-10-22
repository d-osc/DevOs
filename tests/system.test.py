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
        self.assertTrue(all(disk['total'] >= disk['used'] >= 0 for disk in state['storage']))

    def test_battery_values(self):
        base = self.bridge.root / 'power'; base.mkdir()
        battery = base / 'BAT0'; battery.mkdir()
        (battery/'type').write_text('Battery'); (battery/'status').write_text('Charging')
        self.bridge.replace_text('/sys/class/power_supply', str(base))
        for value, expected in [('45',45), ('invalid',None), ('130',100)]:
            (battery/'capacity').write_text(value)
            self.assertEqual(self.bridge.value('bridge.batteries()'), [{'name':'BAT0','status':'Charging','percent':expected}])

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
        self.assertIn('not installed', self.bridge.value('bridge.openPage("display", false)'))

    def test_unsupported_profile_rejected_before_mutation(self):
        self.assertTrue(self.bridge.value('bridge.selectProfile("unsupported-profile")'))

    def test_power_profile_dbus_signature(self):
        folder=self.bridge.root/'commands'; folder.mkdir(); log=self.bridge.root/'profile.args'
        command=folder/'busctl'; command.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" > "{log}"\n'); command.chmod(0o700)
        self.bridge.replace('capture','fn capture(command: str): str { return "\\"balanced\\" \\"power-saver\\"" }')
        self.assertEqual(self.bridge.value('bridge.selectProfile("power-saver")', {'PATH':str(folder)+':'+os.environ['PATH']}), '')
        self.assertEqual(log.read_text().splitlines()[-6:], ['Set','ssv','org.freedesktop.UPower.PowerProfiles','ActiveProfile','s','power-saver'])

if __name__ == '__main__': unittest.main()
