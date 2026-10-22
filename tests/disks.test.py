import json
import unittest
from bridge_support import BridgeFixture, literal
from devlang_support import run_bin

class DiskTests(unittest.TestCase):
    def test_inventory_real_read_only(self):
        result = run_bin('disks', {})
        self.assertEqual(result.returncode, 0, result.stderr)
        devices = json.loads(result.stdout)['devices']
        self.assertIsInstance(devices, list)
        for device in devices:
            self.assertTrue(device['path'].startswith('/dev/'))
            self.assertGreater(device['size'], 0)

    def test_mounted_swap_and_readonly_protection(self):
        bridge = BridgeFixture('bin/dev-os-disks'); self.addCleanup(bridge.close)
        for device in ({'ro': True}, {'children': [{'mountpoints': ['/']}]}, {'mountpoints': ['[SWAP]']}):
            self.assertTrue(bridge.value(f'bridge.blockedReason({literal(device)})'))
        self.assertEqual(bridge.value(f'bridge.blockedReason({literal({"mountpoints": [None], "children": []})})'), '')

if __name__ == '__main__': unittest.main()
