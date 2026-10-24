"""Check the actual suspend guard against missing/bound EC and supported states."""
import configparser
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FILES = ROOT / 'profiles/asus/ux3407na/files'
GUARD = FILES / 'usr/lib/systemd/devos-ux3407na-sleep'


class SleepTests(unittest.TestCase):
    def fixture(self, sys, bound=False, mode='[s2idle] deep'):
        driver = sys / 'bus/i2c/drivers/asus-glymur-ec'
        driver.mkdir(parents=True)
        (sys / 'power').mkdir()
        (sys / 'power/mem_sleep').write_text(mode)
        if bound:
            device = sys / 'devices/ec'
            device.mkdir(parents=True)
            (driver / '9-0076').symlink_to(device)

    def guard(self, sys):
        return subprocess.run(['sh', str(GUARD), 'pre', str(sys)], capture_output=True, text=True)

    def test_missing_or_unbound_ec_refuses_suspend(self):
        with tempfile.TemporaryDirectory() as temporary:
            sys = Path(temporary)
            self.fixture(sys)
            result = self.guard(sys)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('driver is not bound', result.stderr)

    def test_bound_ec_and_s2idle_allow_suspend(self):
        with tempfile.TemporaryDirectory() as temporary:
            sys = Path(temporary)
            self.fixture(sys, bound=True)
            result = self.guard(sys)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_bound_ec_with_deep_only_refuses_suspend(self):
        with tempfile.TemporaryDirectory() as temporary:
            sys = Path(temporary)
            self.fixture(sys, bound=True, mode='[deep]')
            result = self.guard(sys)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('s2idle is unavailable', result.stderr)

    def test_board_policy_does_not_fall_back_to_deep(self):
        config = configparser.ConfigParser()
        config.read(FILES / 'etc/systemd/sleep.conf.d/95-devos-hwprofile.conf')
        self.assertEqual(config['Sleep']['MemorySleepMode'], 's2idle')
        self.assertEqual(config['Sleep']['SuspendState'], 'mem')
        self.assertIn('mem_sleep_default=s2idle', (ROOT / 'profiles/asus/ux3407na/kernel.args').read_text().splitlines())
        config.read(FILES / 'etc/systemd/system/systemd-suspend.service.d/95-devos-hwprofile.conf')
        self.assertIn('devos-ux3407na-sleep pre', config['Service']['ExecStartPre'])

    def test_profile_composition_installs_guard_and_service_drop_in(self):
        with tempfile.TemporaryDirectory() as temporary:
            merged = Path(temporary) / 'merged'
            target = Path(temporary) / 'root'
            target.mkdir()
            env = dict(os.environ, DEVOS_PROFILES_DIR=str(ROOT / 'profiles'))
            tool = ROOT / 'profiles/devos-hwprofile'
            for args in (('compose', 'asus/ux3407na', str(merged)), ('apply', str(target), str(merged))):
                subprocess.run(['sh', str(tool), *args], env=env, check=True, capture_output=True)
            self.assertEqual((target / 'usr/lib/systemd/devos-ux3407na-sleep').read_bytes(), GUARD.read_bytes())
            self.assertTrue((target / 'etc/systemd/system/systemd-suspend.service.d/95-devos-hwprofile.conf').is_file())


if __name__ == '__main__':
    unittest.main()
