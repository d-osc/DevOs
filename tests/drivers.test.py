"""Synthetic sysfs driver tests executing DevLang; no host modules are loaded."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from devlang_support import run_source, use

class DriverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tool = self.root / 'modprobe'
        self.log = self.root / 'calls'
        self.tool.write_text('#!/bin/sh\nprintf "%s\\n" "$@" >> "' + str(self.log) + '"\ncase "$1" in --resolve-alias) printf "module_a\\nmodule_b\\n";; *) exit 1;; esac\n')
        self.tool.chmod(0o755)
    def device(self, bus='pci', name='0000:01:00.0', alias='pci:test'):
        device = self.root / 'bus' / bus / 'devices' / name
        device.mkdir(parents=True)
        if alias: (device / 'modalias').write_text(alias)
        return device
    def evaluate(self, expression):
        source = use('drivers') + 'use "std/json"\nprint(json.stringify(' + expression + '))\n'
        return json.loads(run_source(source))
    def inventory(self, tool=None):
        return self.evaluate(f'drivers.devices({json.dumps(str(self.root))}, {json.dumps(str(self.tool) if tool is None else tool)})')
    def test_bound_driver_never_resolves_modules(self):
        device = self.device()
        target = self.root / 'builtin-driver'
        target.mkdir()
        (device / 'driver').symlink_to(target)
        item = self.inventory()[0]
        self.assertEqual((item['status'], item['driver']), ('bound', 'builtin-driver'))
        self.assertFalse(self.log.exists())
    def test_alias_resolution_and_missing_tool(self):
        self.device(alias='pci:hardware;not-a-command')
        item = self.inventory()[0]
        self.assertEqual(item['modules'], ['module_a', 'module_b'])
        self.assertEqual(item['status'], 'loadable')
        self.assertEqual(self.log.read_text().splitlines(), ['--resolve-alias', 'pci:hardware;not-a-command'])
        self.assertEqual(self.inventory('')[0]['status'], 'needs-review')
    def test_usb_container_and_pci_bridge(self):
        self.device('usb', '1-1')
        self.device('usb', '1-1:1.0')
        bridge = self.device('pci')
        (bridge / 'class').write_text('0x060400')
        self.assertEqual([item['status'] for item in self.inventory()], ['core-managed', 'core-managed', 'loadable'])
    def test_optional_imc_does_not_hide_other_unbound_devices(self):
        imc = self.device('vmbus', 'imc')
        (imc / 'class_id').write_text('{c376c1c3-d276-48d2-90a9-c04748072c60}')
        self.device('vmbus', 'unknown')
        self.assertEqual([item['status'] for item in self.inventory()], ['optional-host-channel', 'loadable'])
    def test_repair_keeps_blacklist_and_failure(self):
        items = [{'bus': 'pci', 'id': 'test', 'status': 'loadable', 'alias': 'pci:test'}, {'status': 'bound'}]
        expression = f'drivers.repair(json.parse({json.dumps(json.dumps(items))}), {json.dumps(str(self.tool))})'
        result = self.evaluate(expression)
        self.assertEqual(result[0]['status'], 'failed')
        self.assertEqual(self.log.read_text().splitlines(), ['--use-blacklist', 'pci:test'])
    def test_missing_hardware_is_not_a_missing_driver(self):
        items = self.evaluate(f'drivers.capabilities({json.dumps(str(self.root))}, true)')
        statuses = {item['name']: item['status'] for item in items}
        self.assertEqual(statuses['wifi'], 'not-exposed')
        self.assertEqual(statuses['bluetooth'], 'not-exposed')
    def test_audio_backend_failure_is_visible(self):
        (self.root / 'class/sound/card0').mkdir(parents=True)
        for name in ('wpctl', 'pactl'):
            tool = self.root / name
            tool.write_text('#!/bin/sh\necho "connection refused" >&2\nexit 1\n')
            tool.chmod(0o755)
        source = use('drivers') + 'use "std/json"\nprint(json.stringify(drivers.capabilities(' + json.dumps(str(self.root)) + ', false)))'
        items = json.loads(run_source(source, env={'PATH': str(self.root) + ':' + os.environ['PATH']}))
        self.assertEqual(next(item for item in items if item['name'] == 'audio')['status'], 'backend-unavailable')
    def profile_run(self, **files):
        run = self.root / 'run-devos-hw'
        run.mkdir()
        for name, content in files.items(): (run / name).write_text(content)
        return run
    def profile_report(self, run):
        firmware = self.root / 'firmware'
        return self.evaluate(f'drivers.hardwareProfile({json.dumps(str(run))}, Vec<str>({json.dumps(str(firmware))}), {json.dumps(str(self.root))})')
    def profile_has_issues(self, report):
        source = use('drivers') + 'use "std/json"\nprint(json.stringify(drivers.profileIssues(json.parse(' + json.dumps(json.dumps(report)) + '))))\n'
        return json.loads(run_source(source))
    def test_profile_not_selected_is_not_an_issue(self):
        report = self.profile_report(self.root / 'missing-run')
        self.assertEqual(report['status'], 'not-selected')
        self.assertFalse(self.profile_has_issues(report))
    def test_profile_firmware_modules_and_blacklist_are_checked(self):
        selection = {'machine_id': 'asus/zenbook-a14-ux3407na', 'form_factor': 'laptop', 'profile': 'asus/ux3407na',
                     'profile_kind': 'model', 'message': 'DEVOS HW: model profile asus/ux3407na'}
        run = self.profile_run(**{'selection.json': json.dumps(selection),
            'profile.conf': 'name=ASUS\ntest_status=untested-on-hardware\nsupport_level=experimental\n',
            'firmware.list': 'qcom/present.mbn\nqcom/compressed.bin\nqcom/missing.mbn\n',
            'modules.load': 'loaded_mod\nabsent-mod\n', 'modules.blacklist': 'noisy_mod\nclean_mod\n', 'quirks.list': 'no-lid-suspend\n'})
        (self.root / 'firmware/qcom').mkdir(parents=True)
        (self.root / 'firmware/qcom/present.mbn').write_text('x')
        (self.root / 'firmware/qcom/compressed.bin.zst').write_text('x')
        (self.root / 'module/loaded_mod').mkdir(parents=True)
        (self.root / 'module/noisy_mod').mkdir()
        report = self.profile_report(run)
        self.assertEqual((report['profile'], report['test_status'], report['support_level']), ('asus/ux3407na', 'untested-on-hardware', 'experimental'))
        self.assertEqual(report['quirks'], ['no-lid-suspend'])
        statuses = {(c['kind'], c['name']): c['status'] for c in report['checks']}
        self.assertEqual(statuses, {('firmware', 'qcom/present.mbn'): 'present', ('firmware', 'qcom/compressed.bin'): 'present',
            ('firmware', 'qcom/missing.mbn'): 'missing', ('module', 'loaded_mod'): 'loaded', ('module', 'absent-mod'): 'not-loaded',
            ('blacklist', 'noisy_mod'): 'loaded-despite-blacklist', ('blacklist', 'clean_mod'): 'absent'})
        self.assertTrue(self.profile_has_issues(report))
    def test_generic_profile_has_nothing_to_check(self):
        run = self.profile_run(**{'selection.json': json.dumps({'profile': 'generic', 'profile_kind': 'generic'}), 'profile.conf': 'test_status=baseline\n'})
        report = self.profile_report(run)
        self.assertEqual((report['status'], report['checks']), ('selected', []))
        self.assertFalse(self.profile_has_issues(report))

if __name__ == '__main__': unittest.main()
