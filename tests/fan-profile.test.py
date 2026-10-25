import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / 'native/devos-fan-profile'
FRONT = ROOT / 'bin/dev-os-fan-profile'


class FanProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sys = self.root / 'sys'; self.sys.mkdir()
        self.state = self.root / 'var/fan-profile.conf'
        self.ppd_log = self.root / 'ppd.log'; self.ppd_profiles = self.root / 'ppd.profiles'
        ppd = self.root / 'powerprofilesctl'
        ppd.write_text(f'#!/bin/sh\nif [ "$1" = list ]; then [ -f {self.ppd_profiles} ] || exit 1; cat {self.ppd_profiles}; exit 0; fi\necho "$*" >> {self.ppd_log}\n'); ppd.chmod(0o755)
        self.ppd = ppd

    def put(self, relative, value):
        path = self.sys / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(str(value) + '\n'); return path

    def platform_profile(self, current='balanced', choices='quiet balanced performance'):
        self.put('firmware/acpi/platform_profile', current); self.put('firmware/acpi/platform_profile_choices', choices)

    def asus(self, value=0): self.put('devices/platform/asus-nb-wmi/throttle_thermal_policy', value)

    def cpufreq(self, governor='schedutil', available='performance schedutil powersave', policies=2):
        for index in range(policies):
            self.put(f'devices/system/cpu/cpufreq/policy{index}/scaling_governor', governor)
            self.put(f'devices/system/cpu/cpufreq/policy{index}/scaling_available_governors', available)

    def supply(self, name, kind, **attributes):
        for key, value in ({'type': kind} | attributes).items(): self.put(f'class/power_supply/{name}/{key}', value)

    def power(self, ac):
        self.supply('AC', 'Mains', online=1 if ac else 0); self.supply('BAT0', 'Battery', present=1, status='Charging' if ac else 'Discharging')

    def ppd_offers(self, *names):
        self.ppd_profiles.write_text(''.join(f'{"*" if i == 0 else " "} {n}:\n    Driver: x\n' for i, n in enumerate(names)))

    def env(self, **extra):
        return os.environ | {'DEVOS_FAN_SYS': str(self.root), 'DEVOS_FAN_STATE': str(self.state), 'DEVOS_FAN_ALLOW_USER': '1',
            'DEVOS_FAN_PPD': str(self.ppd), 'DEVOS_FAN_PROFILE_CORE': str(CORE)} | extra

    def run_core(self, *args, **extra):
        result = subprocess.run(['sh', str(CORE), *args], capture_output=True, text=True, env=self.env(**extra), timeout=20)
        return result.returncode, json.loads(result.stdout)

    def read(self, relative): return (self.sys / relative).read_text().strip()
    def ppd_calls(self): return self.ppd_log.read_text().split('\n')[:-1] if self.ppd_log.exists() else []

    def test_no_backend_is_reported_unsupported_and_nothing_is_written(self):
        # The Snapdragon laptop: the EC only provides a fan tachometer.
        self.put('class/hwmon/hwmon3/fan1_input', 2400); self.power(True)
        code, info = self.run_core('get')
        self.assertEqual(code, 0); self.assertFalse(info['supported']); self.assertEqual((info['backend'], info['modes'], info['rpm']), ('', [], 2400))
        self.assertIn('no platform_profile', info['reason'])
        for args in (('set', 'both', 'whisper'), ('sync', 'on')):
            code, answer = self.run_core(*args); self.assertEqual(code, 1); self.assertIn('does not support', answer['error'])
        self.assertFalse(self.state.exists())
        self.assertEqual(self.run_core('apply')[1], {'ok': True, 'applied': False})

    def test_platform_profile_maps_modes_and_validates_against_choices(self):
        self.platform_profile(); self.power(True)
        info = self.run_core('get')[1]
        self.assertEqual((info['supported'], info['backend'], info['emulated'], info['modes'], info['current']), (True, 'platform_profile', False, ['performance', 'standard', 'whisper'], 'standard'))
        self.assertEqual(self.run_core('set', 'ac', 'whisper')[0], 0); self.assertEqual(self.read('firmware/acpi/platform_profile'), 'quiet')
        self.assertEqual(self.run_core('set', 'ac', 'performance')[0], 0); self.assertEqual(self.read('firmware/acpi/platform_profile'), 'performance')
        info = self.run_core('get')[1]; self.assertEqual((info['current'], info['ac'], info['battery']), ('performance', 'performance', ''))

    def test_platform_profile_without_quiet_uses_low_power_and_hides_missing_modes(self):
        self.platform_profile('balanced', 'low-power balanced'); self.power(True)
        info = self.run_core('get')[1]; self.assertEqual(info['modes'], ['standard', 'whisper'])
        self.run_core('set', 'ac', 'whisper'); self.assertEqual(self.read('firmware/acpi/platform_profile'), 'low-power')
        code, answer = self.run_core('set', 'ac', 'performance'); self.assertEqual(code, 1); self.assertIn('does not offer', answer['error'])
        self.platform_profile('balanced', 'balanced')
        self.assertFalse(self.run_core('get')[1]['supported'])

    def test_class_device_platform_profile(self):
        self.put('class/platform-profile/platform-profile-0/profile', 'balanced'); self.put('class/platform-profile/platform-profile-0/choices', 'low-power balanced performance')
        self.power(True)
        self.assertEqual(self.run_core('get')[1]['backend'], 'platform_profile')
        self.run_core('set', 'ac', 'performance'); self.assertEqual(self.read('class/platform-profile/platform-profile-0/profile'), 'performance')

    def test_asus_wmi_throttle_policy(self):
        self.asus(0); self.power(True)
        info = self.run_core('get')[1]; self.assertEqual((info['backend'], info['hotkey'], info['current']), ('asus_wmi', True, 'standard'))
        for mode, raw in (('performance', '1'), ('whisper', '2'), ('standard', '0')):
            self.assertEqual(self.run_core('set', 'ac', mode)[0], 0); self.assertEqual(self.read('devices/platform/asus-nb-wmi/throttle_thermal_policy'), raw)

    def test_platform_profile_wins_over_asus_wmi_and_cpufreq(self):
        self.platform_profile(); self.asus(0); self.cpufreq(); self.power(True)
        self.assertEqual(self.run_core('get')[1]['backend'], 'platform_profile')
        self.run_core('set', 'ac', 'performance')
        self.assertEqual((self.read('devices/platform/asus-nb-wmi/throttle_thermal_policy'), self.read('devices/system/cpu/cpufreq/policy0/scaling_governor')), ('0', 'schedutil'))

    def test_cpufreq_fallback_is_labelled_emulated_and_sets_every_policy(self):
        self.cpufreq(); self.power(True)
        info = self.run_core('get')[1]; self.assertEqual((info['backend'], info['emulated'], info['hotkey'], info['current']), ('cpufreq', True, False, 'standard'))
        self.run_core('set', 'ac', 'whisper')
        self.assertEqual([self.read(f'devices/system/cpu/cpufreq/policy{i}/scaling_governor') for i in (0, 1)], ['powersave', 'powersave'])
        self.put('devices/system/cpu/cpufreq/policy1/scaling_governor', 'performance')
        self.assertEqual(self.run_core('get')[1]['current'], '')

    def test_cpufreq_needs_a_governor_common_to_all_policies_and_two_modes(self):
        self.cpufreq(available='schedutil'); self.power(True)
        info = self.run_core('get')[1]; self.assertFalse(info['supported'])
        self.cpufreq(available='performance schedutil')
        self.put('devices/system/cpu/cpufreq/policy1/scaling_available_governors', 'schedutil powersave')
        self.assertFalse(self.run_core('get')[1]['supported'])

    def test_profile_per_power_source_is_applied_for_the_active_source(self):
        self.platform_profile(); self.power(True)
        self.run_core('set', 'ac', 'performance'); self.run_core('set', 'battery', 'whisper')
        # Setting the other source does not change the hardware while plugged in.
        self.assertEqual(self.read('firmware/acpi/platform_profile'), 'performance')
        self.power(False)
        info = self.run_core('get')[1]; self.assertEqual((info['source'], info['ac'], info['battery']), ('battery', 'performance', 'whisper'))
        self.assertEqual(self.run_core('apply')[1], {'ok': True, 'applied': True}); self.assertEqual(self.read('firmware/acpi/platform_profile'), 'quiet')
        self.power(True); self.run_core('apply'); self.assertEqual(self.read('firmware/acpi/platform_profile'), 'performance')
        self.assertEqual(self.state.read_text(), 'ac=performance\nbattery=whisper\nsync=1\n')

    def test_both_sources_and_boot_apply_use_the_saved_state_only(self):
        self.platform_profile('performance'); self.power(False)
        self.assertEqual(self.run_core('apply')[1], {'ok': True, 'applied': False}); self.assertEqual(self.read('firmware/acpi/platform_profile'), 'performance')
        self.run_core('set', 'both', 'standard'); self.assertEqual(self.read('firmware/acpi/platform_profile'), 'balanced')
        self.put('firmware/acpi/platform_profile', 'quiet'); self.run_core('apply'); self.assertEqual(self.read('firmware/acpi/platform_profile'), 'balanced')

    def test_power_source_detection(self):
        self.platform_profile()
        self.assertEqual(self.run_core('get')[1]['source'], 'ac')  # no supplies at all: a desktop
        self.supply('BAT0', 'Battery', present=1, status='Not charging'); self.assertEqual(self.run_core('get')[1]['source'], 'ac')
        self.supply('BAT0', 'Battery', present=1, status='Discharging'); self.assertEqual(self.run_core('get')[1]['source'], 'battery')
        self.supply('mouse', 'Battery', scope='Device', status='Charging'); self.assertEqual(self.run_core('get')[1]['source'], 'battery')
        self.supply('usb', 'USB_C', online=1); self.assertEqual(self.run_core('get')[1]['source'], 'ac')

    def test_power_mode_synchronization_drives_power_profiles_daemon(self):
        self.platform_profile(); self.power(True); self.ppd_offers('balanced', 'performance', 'power-saver')
        info = self.run_core('get')[1]; self.assertEqual((info['sync'], info['syncAvailable']), (True, True))
        self.run_core('set', 'ac', 'performance'); self.run_core('set', 'ac', 'whisper'); self.run_core('set', 'ac', 'standard')
        self.assertEqual(self.ppd_calls(), ['set performance', 'set power-saver', 'set balanced'])
        self.assertEqual(self.read('firmware/acpi/platform_profile'), 'balanced')
        self.assertEqual(self.run_core('sync', 'off')[0], 0); self.assertFalse(self.run_core('get')[1]['sync'])
        self.run_core('set', 'ac', 'performance'); self.assertEqual(len(self.ppd_calls()), 3)
        self.assertEqual(self.run_core('sync', 'on')[0], 0); self.assertEqual(self.ppd_calls()[-1], 'set performance')

    def test_synchronization_is_unavailable_without_power_profiles(self):
        self.platform_profile(); self.power(True)
        self.assertFalse(self.run_core('get')[1]['syncAvailable'])
        self.ppd_offers('balanced'); self.assertFalse(self.run_core('get')[1]['syncAvailable'])
        code, answer = self.run_core('sync', 'on'); self.assertEqual(code, 1); self.assertIn('not available', answer['error'])
        self.assertEqual(self.run_core('set', 'ac', 'whisper')[0], 0); self.assertEqual(self.ppd_calls(), [])

    def test_ignored_writes_are_errors(self):
        self.asus(0); self.power(True)
        path = self.sys / 'devices/platform/asus-nb-wmi/throttle_thermal_policy'; path.chmod(0o444)
        if os.geteuid() != 0:
            code, answer = self.run_core('set', 'ac', 'performance'); self.assertEqual(code, 1); self.assertIn('rejected', answer['error'])
        path.chmod(0o644)

    def test_invalid_requests_and_unprivileged_use_are_rejected(self):
        self.platform_profile(); self.power(True)
        for args in (('set', 'ac', 'turbo'), ('set', 'wifi', 'whisper'), ('set', 'ac'), ('sync', 'maybe'), ('fan', '5'), ()):
            code, answer = self.run_core(*args); self.assertEqual(code, 1, args); self.assertFalse(answer['ok'])
        if os.geteuid() != 0:
            code, answer = self.run_core('set', 'ac', 'whisper', DEVOS_FAN_ALLOW_USER=''); self.assertEqual(code, 1); self.assertIn('administrator', answer['error'])
        self.assertEqual((self.read('firmware/acpi/platform_profile'), self.state.exists()), ('balanced', False))

    def test_corrupt_state_values_are_never_written_to_sysfs(self):
        self.platform_profile(); self.power(True)
        self.state.parent.mkdir(parents=True); self.state.write_text('ac=../../etc/passwd\nbattery=performance\nsync=1\n')
        self.assertEqual(self.run_core('apply')[1], {'ok': True, 'applied': False}); self.assertEqual(self.read('firmware/acpi/platform_profile'), 'balanced')
        self.state.write_text('ac=turbo\n'); self.assertEqual(self.run_core('apply')[1], {'ok': True, 'applied': False})

    def test_front_end_runs_privileged_actions_and_returns_state(self):
        self.platform_profile(); self.power(True)
        def front(*args):
            result = subprocess.run(['sh', str(FRONT), *args], capture_output=True, text=True, env=self.env(), timeout=20)
            return result.returncode, json.loads(result.stdout)
        code, info = front('set', 'ac', 'whisper'); self.assertEqual((code, info['current'], info['ac']), (0, 'whisper', 'whisper'))
        self.assertEqual(self.read('firmware/acpi/platform_profile'), 'quiet')
        code, answer = front('set', 'ac', 'bogus'); self.assertEqual(code, 1); self.assertFalse(answer['ok'])
        code, answer = front('reboot'); self.assertEqual(code, 1); self.assertFalse(answer['ok'])
        self.assertTrue(front('get')[1]['supported'])

    def test_fan_speed_is_read_from_the_first_numeric_hwmon_fan(self):
        self.platform_profile(); self.put('class/hwmon/hwmon1/fan1_input', 'n/a'); self.put('class/hwmon/hwmon2/fan1_input', 3100)
        self.assertEqual(self.run_core('get')[1]['rpm'], 3100)


if __name__ == '__main__': unittest.main()
