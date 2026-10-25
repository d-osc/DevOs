import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / 'native/devos-battery-care'
FRONT = ROOT / 'bin/dev-os-battery-care'
T0 = 1_800_000_000


class BatteryCareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.ps = self.root / 'sys/class/power_supply'; self.ps.mkdir(parents=True)
        self.state = self.root / 'var/battery-care.conf'
        self.calls = self.root / 'systemd.log'
        for name in ('systemd-run', 'systemctl'):
            stub = self.root / name
            stub.write_text(f'#!/bin/sh\necho "{name} $*" >> {self.calls}\n'); stub.chmod(0o755)
        self.now = T0

    def supply(self, name, kind='Battery', **attributes):
        directory = self.ps / name; directory.mkdir(parents=True, exist_ok=True)
        (directory / 'type').write_text(kind + '\n')
        for key, value in attributes.items(): (directory / key).write_text(str(value) + '\n')
        return directory

    def env(self, **extra):
        return os.environ | {'DEVOS_BATTERY_SYS': str(self.root), 'DEVOS_BATTERY_STATE': str(self.state), 'DEVOS_BATTERY_NOW': str(self.now),
            'DEVOS_BATTERY_ALLOW_USER': '1', 'DEVOS_BATTERY_SYSTEMD_RUN': str(self.root / 'systemd-run'),
            'DEVOS_BATTERY_SYSTEMCTL': str(self.root / 'systemctl'), 'DEVOS_BATTERY_QUICK_CONF': str(self.root / 'quick.conf'),
            'DEVOS_BATTERY_CARE_CORE': str(CORE)} | extra

    def run_core(self, *args, **extra):
        result = subprocess.run(['sh', str(CORE), *args], capture_output=True, text=True, env=self.env(**extra), timeout=20)
        return result.returncode, json.loads(result.stdout)

    def threshold(self, name='BAT0'): return (self.ps / name / 'charge_control_end_threshold').read_text().strip()

    def test_no_attribute_is_reported_unsupported_and_nothing_is_written(self):
        self.supply('qcom-battmgr-bat', present=1, status='Not charging')
        _, info = self.run_core('get')
        self.assertFalse(info['supported']); self.assertEqual(info['battery'], 'qcom-battmgr-bat'); self.assertIn('charge limit', info['reason'])
        for args in (('care', 'on'), ('full', 'on')):
            code, answer = self.run_core(*args)
            self.assertEqual(code, 1); self.assertFalse(answer['ok']); self.assertIn('does not support', answer['error'])
        self.assertFalse(self.state.exists()); self.assertFalse((self.ps / 'qcom-battmgr-bat/charge_control_end_threshold').exists())

    def test_no_battery_at_all(self):
        self.supply('AC', 'Mains', online=1)
        _, info = self.run_core('get')
        self.assertFalse(info['supported']); self.assertEqual(info['battery'], ''); self.assertIn('No battery', info['reason'])

    def test_only_real_batteries_with_the_attribute_are_touched(self):
        self.supply('BAT0', charge_control_end_threshold=100, present=1)
        self.supply('hid-mouse-battery', scope='Device', charge_control_end_threshold=100)
        self.supply('AC', 'Mains', charge_control_end_threshold=100)
        self.supply('BAT1', present=0, charge_control_end_threshold=100)
        self.assertEqual(self.run_core('care', 'on')[0], 0)
        self.assertEqual(self.threshold('BAT0'), '80')
        for other in ('hid-mouse-battery', 'AC', 'BAT1'): self.assertEqual(self.threshold(other), '100', other)

    def test_care_and_full_charge_interact_and_expire_after_24_hours(self):
        self.supply('BAT0', charge_control_end_threshold=100, present=1)
        code, answer = self.run_core('full', 'on')
        self.assertEqual(code, 1); self.assertIn('Battery Care Mode first', answer['error']); self.assertEqual(self.threshold(), '100')
        self.run_core('care', 'on'); self.assertEqual(self.threshold(), '80')
        self.assertEqual(self.run_core('full', 'on')[0], 0)
        info = self.run_core('get')[1]
        self.assertEqual((self.threshold(), info['care'], info['full'], info['fullUntil'], info['remaining']), ('100', True, True, T0 + 86400, 86400))
        self.assertIn('systemd-run --quiet --unit=devos-battery-care-expire --on-active=86400', self.calls.read_text())
        self.now = T0 + 86400 - 1; self.run_core('apply'); self.assertEqual(self.threshold(), '100')
        self.now = T0 + 86400; self.run_core('apply')
        info = self.run_core('get')[1]
        self.assertEqual((self.threshold(), info['care'], info['full'], info['fullUntil']), ('80', True, False, 0))

    def test_expiry_survives_reboot_and_manual_changes_end_full_charge(self):
        self.supply('BAT0', charge_control_end_threshold=100, present=1)
        self.run_core('care', 'on'); self.run_core('full', 'on')
        # A reboot resets the driver; boot-time apply while the deadline is still in the future keeps 100%.
        (self.ps / 'BAT0/charge_control_end_threshold').write_text('100\n'); self.now = T0 + 3600; self.run_core('apply')
        self.assertTrue(self.run_core('get')[1]['full'])
        self.now = T0 + 90000; self.run_core('apply'); self.assertEqual(self.threshold(), '80')
        self.run_core('full', 'on'); self.assertEqual(self.threshold(), '100')
        self.run_core('full', 'off'); self.assertEqual((self.threshold(), self.run_core('get')[1]['care']), ('80', True))
        self.run_core('full', 'on'); self.run_core('care', 'off')
        info = self.run_core('get')[1]; self.assertEqual((self.threshold(), info['care'], info['full']), ('100', False, False))

    def test_clock_moved_back_does_not_extend_full_charge(self):
        self.supply('BAT0', charge_control_end_threshold=100, present=1)
        self.run_core('care', 'on'); self.run_core('full', 'on')
        self.now = T0 - 10 * 86400; self.run_core('apply')
        self.assertEqual((self.threshold(), self.run_core('get')[1]['full']), ('80', False))

    def test_apply_without_saved_preferences_leaves_the_firmware_limit_alone(self):
        self.supply('BAT0', charge_control_end_threshold=60, present=1)
        self.assertEqual(self.run_core('apply')[1], {'ok': True, 'applied': False}); self.assertEqual(self.threshold(), '60')

    def test_ignored_writes_are_errors(self):
        self.supply('BAT0', charge_control_end_threshold=100, present=1)
        # A read-only attribute stands in for a driver that refuses the write.
        path = self.ps / 'BAT0/charge_control_end_threshold'
        path.write_text('100\n')
        path.chmod(0o444)
        if os.geteuid() != 0:
            code, answer = self.run_core('care', 'on'); self.assertEqual(code, 1); self.assertIn('rejected', answer['error'])
        path.chmod(0o644)

    def test_start_threshold_is_lowered_only_when_needed(self):
        self.supply('BAT0', charge_control_end_threshold=100, charge_control_start_threshold=90, present=1, charge_behaviour='[auto] inhibit-charge')
        self.run_core('care', 'on')
        self.assertEqual((self.threshold(), (self.ps / 'BAT0/charge_control_start_threshold').read_text().strip()), ('80', '75'))
        info = self.run_core('get')[1]; self.assertTrue(info['hasStart'] and info['hasBehaviour'])
        self.assertEqual((self.ps / 'BAT0/charge_behaviour').read_text().strip(), '[auto] inhibit-charge')

    def test_invalid_requests_and_unprivileged_use_are_rejected(self):
        self.supply('BAT0', charge_control_end_threshold=100, present=1)
        for args in (('care', 'maybe'), ('full',), ('limit', '10'), ()):
            code, answer = self.run_core(*args); self.assertEqual(code, 1); self.assertFalse(answer['ok'])
        if os.geteuid() != 0:
            code, answer = self.run_core('care', 'on', DEVOS_BATTERY_ALLOW_USER=''); self.assertEqual(code, 1); self.assertIn('administrator', answer['error'])
        self.assertEqual(self.threshold(), '100')

    def test_unsafe_device_names_are_ignored(self):
        self.supply('BAT0', charge_control_end_threshold=100, present=1)
        evil = self.ps / 'BAT$(touch pwned)'; evil.mkdir(); (evil / 'type').write_text('Battery\n'); (evil / 'charge_control_end_threshold').write_text('100\n')
        self.run_core('care', 'on')
        self.assertFalse((self.root / 'pwned').exists() or Path('pwned').exists()); self.assertEqual((evil / 'charge_control_end_threshold').read_text().strip(), '100')

    def test_front_end_merges_the_per_user_quick_choice_and_runs_privileged_actions(self):
        self.supply('BAT0', charge_control_end_threshold=100, present=1)
        def front(*args):
            result = subprocess.run(['sh', str(FRONT), *args], capture_output=True, text=True, env=self.env(), timeout=20)
            return result.returncode, json.loads(result.stdout)
        self.assertTrue(front('get')[1]['quick'])
        self.assertFalse(front('quick', 'off')[1]['quick']); self.assertFalse(front('get')[1]['quick'])
        code, info = front('care', 'on'); self.assertEqual((code, info['care'], info['supported']), (0, True, True)); self.assertEqual(self.threshold(), '80')
        self.assertEqual(front('full', 'on')[1]['remaining'], 86400)
        code, answer = front('care', 'x'); self.assertEqual(code, 1); self.assertFalse(answer['ok'])
        self.assertFalse(front('full', 'off')[1]['full'])


if __name__ == '__main__': unittest.main()
