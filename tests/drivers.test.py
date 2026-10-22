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

if __name__ == '__main__': unittest.main()
