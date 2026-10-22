from datetime import datetime, timezone
import json
import os
import unittest
from bridge_support import BridgeFixture

class TimeTests(unittest.TestCase):
    def setUp(self):
        self.bridge = BridgeFixture('bin/dev-os-time'); self.addCleanup(self.bridge.close)
        self.props(ntp=True)
        self.bridge.replace('isWsl', 'fn isWsl(): bool { return false }')
        folder = self.bridge.root / 'commands'; folder.mkdir()
        self.log = self.bridge.root / 'busctl.args'
        command = folder / 'busctl'
        command.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" > "{self.log}"\n'); command.chmod(0o700)
        self.env = {'PATH': str(folder) + ':' + os.environ['PATH']}

    def props(self, ntp=False, can=True):
        raw = f'Timezone "UTC"\nNTP {str(ntp).lower()}\nCanNTP {str(can).lower()}\nNTPSynchronized true\n'
        self.bridge.replace('timedateProperties', f'fn timedateProperties(): str {{ return {json.dumps(raw)} }}')

    def call(self, request):
        result = self.bridge.cli(request, self.env)
        self.assertTrue(result.stdout, result.stderr)
        return json.loads(result.stdout)

    def test_snapshot_and_offline(self):
        state = self.call({'action': 'get'})['state']
        self.assertTrue(state['available'] and state['synchronized'])
        state = self.bridge.value('bridge.snapshot("", "No system bus")')
        self.assertFalse(state['available']); self.assertTrue(state['error'])
        state=self.bridge.value('bridge.snapshot("a{sv} 4 \\"Timezone\\" s \\"Asia/Bangkok\\" \\"NTP\\" b false \\"CanNTP\\" b true \\"NTPSynchronized\\" b true", "")')
        self.assertFalse(state['ntp']); self.assertTrue(state['canNtp']); self.assertTrue(state['synchronized'])
        self.assertEqual(state['timezone'],'Asia/Bangkok')

    def test_timezone_ntp_and_manual_dbus_arguments(self):
        self.assertTrue(self.call({'action': 'set-timezone', 'timezone': 'UTC'})['ok'])
        self.assertEqual(self.log.read_text().splitlines()[-4:], ['SetTimezone', 'sb', 'UTC', 'true'])
        self.props(ntp=False)
        self.assertTrue(self.call({'action': 'set-ntp', 'enabled': False})['ok'])
        self.assertEqual(self.log.read_text().splitlines()[-4:], ['SetNTP', 'bb', 'false', 'true'])
        self.assertTrue(self.call({'action': 'set-time', 'date': '2026-10-17', 'time': '09:30'})['ok'])
        expected = int(datetime(2026,10,17,9,30,tzinfo=timezone.utc).timestamp()) * 1000000
        self.assertEqual(self.log.read_text().splitlines()[-5:], ['SetTime', 'xbb', str(expected), 'false', 'true'])
        self.assertEqual(self.bridge.value('bridge.timestampFor("2026-10-17", "16:30", "Asia/Bangkok")'), expected)

    def test_rejects_invalid_requests_without_bus_mutation(self):
        for request in ({'action': 'set-time', 'date': '2026-10-17', 'time': '09:30'}, {'action': 'set-timezone', 'timezone': '../../etc/passwd'}, {'action': 'set-ntp', 'enabled': 'false'}, {'action': 'unknown'}):
            self.assertIn('error', self.call(request))
            self.assertFalse(self.log.exists())

    def test_invalid_and_ambiguous_local_time(self):
        for date, clock, zone in [('2026-02-30','12:00','UTC'), ('2026-10-17','25:00','UTC'), ('2026-03-08','02:30','America/New_York'), ('2026-11-01','01:30','America/New_York')]:
            self.assertEqual(self.bridge.value(f'bridge.timestampFor({json.dumps(date)}, {json.dumps(clock)}, {json.dumps(zone)})'), -1)

    def test_wsl_and_unavailable_ntp_guards(self):
        self.bridge.replace('isWsl', 'fn isWsl(): bool { return true }')
        for request in ({'action':'set-ntp','enabled':True}, {'action':'set-time','date':'2026-10-17','time':'09:30'}):
            self.assertIn('Windows', self.call(request)['error']); self.assertFalse(self.log.exists())
        self.assertTrue(self.call({'action':'set-timezone','timezone':'Asia/Bangkok'})['ok'])
        self.log.unlink(); self.props(can=False)
        self.bridge.replace('isWsl', 'fn isWsl(): bool { return false }')
        self.assertIn('error', self.call({'action':'set-ntp','enabled':True})); self.assertFalse(self.log.exists())

if __name__ == '__main__': unittest.main()
