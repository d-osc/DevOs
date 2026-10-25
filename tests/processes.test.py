import os
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from bridge_support import BridgeFixture, literal

class ProcessesTest(unittest.TestCase):
    def setUp(self):
        self.bridge = BridgeFixture('bin/dev-os-processes'); self.addCleanup(self.bridge.close)

    def test_sampling(self):
        result = self.bridge.invoke('let previous = bridge.rawSample(4096, {}); return bridge.sample(previous, {}, 4096, 100, bridge.selfPidValue())')
        state = result['value']
        self.assertGreater(state['memoryTotal'], 0)
        self.assertTrue(0 <= state['cpu'] <= 100)
        own = next(row for row in state['processes'] if row['pid'] == os.getpid())
        self.assertFalse(own['canStop'])
        self.assertGreater(own['memory'], 0)

    def test_sampler_starts_without_getconf(self):
        with tempfile.TemporaryDirectory() as tmp:
            tool = Path(tmp) / 'getconf'
            tool.write_text('#!/bin/sh\nprintf "getconf is not installed\\n" >&2\nexit 127\n')
            tool.chmod(0o755)
            result = self.bridge.cli({'action': 'get'}, env={'PATH': tmp + os.pathsep + os.environ['PATH']})
            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads(result.stdout)
            self.assertTrue(state['ok'])
            self.assertGreater(state['memoryTotal'], 0)
            self.assertGreater(len(state['processes']), 0)

    def test_sampling_parameters_match_libc(self):
        self.assertEqual(self.bridge.value('bridge.confValue("PAGE_SIZE")'), os.sysconf('SC_PAGE_SIZE'))
        self.assertEqual(self.bridge.value('bridge.confValue("CLK_TCK")'), os.sysconf('SC_CLK_TCK'))

    def test_uid_cache_and_owner(self):
        child = subprocess.Popen(['sleep', '30'])
        try:
            info = self.bridge.value(f'bridge.readProcess({child.pid}, 4096, {{}})')
            self.assertEqual(info['uid'], os.getuid())
            key = f'{child.pid}:{info["start"]}'
            cached = self.bridge.value(f'bridge.readProcess({child.pid}, 4096, {literal({key: 4242})})')
            self.assertEqual(cached['uid'], 4242, 'a cached owner must not be re-read')
        finally:
            child.kill(); child.wait()

    def test_refresh_cost_scales_without_subprocesses(self):
        children = [subprocess.Popen(['sleep', '30']) for _ in range(150)]
        try:
            self.bridge.invoke('let previous = bridge.rawSample(4096, {}); return bridge.sample(previous, {}, 4096, 100, bridge.selfPidValue())')
            started = time.monotonic()
            result = self.bridge.invoke('let previous = bridge.rawSample(4096, {}); return bridge.sample(previous, {}, 4096, 100, bridge.selfPidValue())')
            elapsed = time.monotonic() - started
            count = len(result['value']['processes'])
            self.assertGreaterEqual(count, 150)
            # Two samples (raw + diff) per call; the old sh+stat per process cost ~4 ms each and failed this.
            print(f'refresh benchmark: {count} processes, {elapsed * 1000:.0f} ms for two samples')
            self.assertLess(elapsed / count / 2, 0.0015)
        finally:
            for child in children: child.kill()
            for child in children: child.wait()

    def test_protected(self):
        for pid in (1, os.getpid(), os.getppid()):
            result = self.bridge.value(f'bridge.stopProcess({literal({"pid": pid, "start": "0"})}, 4096, bridge.selfPidValue())')
            self.assertIn('error', result)

    def test_real_termination_and_stale_identity(self):
        if os.getuid() == 0: self.skipTest('Run as a desktop user to test termination')
        for force in (False, True):
            child = subprocess.Popen(['sleep', '30'])
            try:
                info = self.bridge.value(f'bridge.readProcess({child.pid}, 4096, {{}})')
                self.assertIn('error', self.bridge.value(f'bridge.stopProcess({literal({"pid": child.pid, "start": "invalid", "force": force})}, 4096, bridge.selfPidValue())'))
                self.assertIsNone(child.poll())
                result = self.bridge.value(f'bridge.stopProcess({literal({"pid": child.pid, "start": info["start"], "force": force})}, 4096, bridge.selfPidValue())')
                self.assertNotIn('error', result)
                self.assertEqual(child.wait(timeout=3), -9 if force else -15)
            finally:
                if child.poll() is None: child.kill(); child.wait()

if __name__ == '__main__': unittest.main()
