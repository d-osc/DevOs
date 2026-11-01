"""Real persistent DevLang catalog daemon and its CLI/PM consumers."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import signal
import socket
import stat
import subprocess
import tempfile
import time
import unittest
from devlang_support import D, ROOT

DB = ROOT / 'app-db'


class AppDbServiceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='devos-app-db-service-')
        self.root = Path(self.temporary.name)
        self.source = self.root / 'catalog with spaces'
        self.app = self.source / 'apps/demo/app.json'
        self.app.parent.mkdir(parents=True)
        self.manifest = dict(schema_version=2, id='demo', name='Demo', aliases=['demo-alias'], status='catalog')
        self.app.write_text(json.dumps(self.manifest))
        self.runtime = self.root / 'runtime'
        self.env = os.environ | {'DEVOS_APP_DB_RUNTIME': str(self.runtime)}

    def tearDown(self):
        # Own only the PIDs recorded under this fixture's private runtime directory.
        for endpoint in self.runtime.glob('*.json'):
            try:
                info = json.loads(endpoint.read_text())
                os.kill(info['pid'], signal.SIGTERM)
            except (FileNotFoundError, ProcessLookupError):
                pass
        self.temporary.cleanup()

    def cli(self, *args, source=None, success=True):
        result = subprocess.run([D, str(DB / 'database-cli.dev'), '--', '--source', str(source or self.source), *args],
                                env=self.env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def endpoint(self):
        return json.loads(next(self.runtime.glob('*.json')).read_text())

    def rpc(self, data, *, token=True, fragmented=False):
        info = self.endpoint()
        if token: data = data | {'token': info['token']}
        body = json.dumps(data).encode() + b'\n'
        with socket.create_connection(('127.0.0.1', info['port']), timeout=4) as stream:
            if fragmented:
                stream.sendall(body[:7]); time.sleep(.05); stream.sendall(body[7:])
            else: stream.sendall(body)
            received = b''
            while chunk := stream.recv(65536): received += chunk
        return json.loads(received)

    def test_single_daemon_for_concurrent_clients_and_pm(self):
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: self.cli('--action', 'health'), range(6)))
        self.assertEqual(len({item['pid'] for item in results}), 1)
        endpoint = next(self.runtime.glob('*.json'))
        self.assertEqual(stat.S_IMODE(endpoint.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.runtime.stat().st_mode), 0o700)
        result = subprocess.run([D, str(ROOT / 'pm-cli/main.dev'), '--', 'catalog', '--catalog', str(self.source), '--json'],
                                env=self.env | {'DEV_ROOT': str(self.root / 'store')}, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['apps'][0]['manifest']['id'], 'demo')
        self.assertEqual(self.cli('--action', 'health')['pid'], results[0]['pid'])

    def test_live_updates_search_aliases_and_source_isolation(self):
        pid = self.cli('--action', 'health')['pid']
        self.manifest['name'] = 'Changed At Source'; self.app.write_text(json.dumps(self.manifest))
        self.assertEqual(self.cli()['apps'][0]['manifest']['name'], 'Changed At Source')
        self.assertEqual(self.cli('--action', 'get', '--query', 'demo-alias')['manifest']['id'], 'demo')
        self.assertEqual(len(self.cli('--action', 'search', '--query', 'changed')['apps']), 1)
        self.assertEqual(self.cli('--action', 'health')['pid'], pid)
        self.manifest['software_type'] = 'package'; self.app.write_text(json.dumps(self.manifest))
        self.assertEqual(self.cli()['apps'][0]['softwareType'], 'package')
        self.manifest['software_type'] = 'invalid'; self.app.write_text(json.dumps(self.manifest))
        self.assertIn('error', self.cli(success=False))
        self.manifest.pop('software_type'); self.app.write_text(json.dumps(self.manifest))
        other = self.root / 'other'; (other / 'apps').mkdir(parents=True)
        self.assertNotEqual(self.cli('--action', 'health', source=other)['pid'], pid)

    def test_bad_requests_are_bounded_and_do_not_kill_daemon(self):
        pid = self.cli('--action', 'health')['pid']
        self.assertIn('error', self.rpc({'action': 'catalog', 'arch': 'arm64'}, token=False))
        self.assertIn('error', self.rpc({'action': 'delete', 'arch': 'arm64'}))
        self.assertTrue(self.rpc({'action': 'health'}, fragmented=True)['ready'])
        info = self.endpoint()
        with socket.create_connection(('127.0.0.1', info['port']), timeout=4) as idle:
            self.assertIn(b'error', idle.recv(4096))
        for payload in (b'not json\n', b'x' * 66000 + b'\n'):
            with socket.create_connection(('127.0.0.1', info['port']), timeout=4) as stream:
                stream.sendall(payload)
                try: self.assertIn(b'error', stream.recv(4096))
                except ConnectionResetError: pass  # Oversized peers can be disconnected with unread bytes.
        self.app.write_text('{broken')
        self.assertIn('error', self.cli(success=False))
        self.app.write_text(json.dumps(self.manifest))
        self.assertEqual(self.cli('--action', 'health')['pid'], pid)

    def test_crashed_daemon_is_restarted(self):
        pid = self.cli('--action', 'health')['pid']
        os.kill(pid, signal.SIGKILL)
        time.sleep(.1)
        replacement = self.cli('--action', 'health')
        self.assertNotEqual(replacement['pid'], pid)
        self.assertTrue(replacement['ready'])

    def test_extensions_are_separate_and_drafts_are_not_installable(self):
        folder = self.source / 'extensions/org.example.notes'; folder.mkdir(parents=True)
        listing = dict(schema_version=2, kind='extension', id='org.example.notes', name='Notes',
                       status='draft', summary='Workspace notes', manifest='extension.json')
        (folder / 'listing.json').write_text(json.dumps(listing))
        (folder / 'extension.json').write_text(json.dumps(dict(id='org.example.notes', name='Notes', version='1.0.0')))
        result = self.cli()
        self.assertEqual(len(result['apps']), 1)
        self.assertEqual(result['extensions'][0]['id'], 'org.example.notes')
        self.assertEqual(result['extensions'][0]['status'], 'draft')
        self.assertIs(result['extensions'][0]['installable'], False)
        pid = self.cli('--action', 'health')['pid']
        listing['manifest'] = '../outside.json'; (folder / 'listing.json').write_text(json.dumps(listing))
        self.assertIn('error', self.cli(success=False))
        self.assertEqual(self.cli('--action', 'health')['pid'], pid)


if __name__ == '__main__':
    unittest.main()
