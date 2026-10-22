import os
import subprocess
import unittest
from bridge_support import BridgeFixture, literal

class ProcessesTest(unittest.TestCase):
    def setUp(self):
        self.bridge = BridgeFixture('bin/dev-os-processes'); self.addCleanup(self.bridge.close)

    def test_sampling(self):
        result = self.bridge.invoke('let previous = bridge.rawSample(4096); return bridge.sample(previous, {}, 4096, 100)')
        state = result['value']
        self.assertGreater(state['memoryTotal'], 0)
        self.assertTrue(0 <= state['cpu'] <= 100)
        own = next(row for row in state['processes'] if row['pid'] == os.getpid())
        self.assertFalse(own['canStop'])
        self.assertGreater(own['memory'], 0)

    def test_protected(self):
        for pid in (1, os.getpid(), os.getppid()):
            result = self.bridge.value(f'bridge.stopProcess({literal({"pid": pid, "start": "0"})}, 4096)')
            self.assertIn('error', result)

    def test_real_termination_and_stale_identity(self):
        if os.getuid() == 0: self.skipTest('Run as a desktop user to test termination')
        for force in (False, True):
            child = subprocess.Popen(['sleep', '30'])
            try:
                info = self.bridge.value(f'bridge.readProcess({child.pid}, 4096)')
                self.assertIn('error', self.bridge.value(f'bridge.stopProcess({literal({"pid": child.pid, "start": "invalid", "force": force})}, 4096)'))
                self.assertIsNone(child.poll())
                result = self.bridge.value(f'bridge.stopProcess({literal({"pid": child.pid, "start": info["start"], "force": force})}, 4096)')
                self.assertNotIn('error', result)
                self.assertEqual(child.wait(timeout=3), -9 if force else -15)
            finally:
                if child.poll() is None: child.kill(); child.wait()

if __name__ == '__main__': unittest.main()
