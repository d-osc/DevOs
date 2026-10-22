import unittest
from bridge_support import BridgeFixture

class BacklightTest(unittest.TestCase):
    def setUp(self):
        self.bridge = BridgeFixture('bin/dev-os-backlight'); self.addCleanup(self.bridge.close)
        self.bridge.replace_text('/sys/class/backlight', str(self.bridge.root / 'backlight'))
        (self.bridge.root / 'backlight').mkdir()

    def test_writes_scaled_kernel_value(self):
        device = self.bridge.root / 'backlight/panel'; device.mkdir()
        (device / 'max_brightness').write_text('1023'); (device / 'brightness').write_text('500')
        self.assertEqual(self.bridge.value('bridge.setBrightness(50)')['brightness'], 50)
        self.assertEqual((device / 'brightness').read_text().strip(), '512')
        self.bridge.value('bridge.setBrightness(1)')
        self.assertEqual((device / 'brightness').read_text().strip(), '10')

    def test_rejects_missing_driver_and_out_of_range(self):
        for percent in (50, 0, 101, -5):
            self.assertIn('error', self.bridge.value(f'bridge.setBrightness({percent})'))

if __name__ == '__main__': unittest.main()
