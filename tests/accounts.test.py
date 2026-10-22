"""Account device-flow tests with a local HTTP fixture and the real DevLang runtime."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import subprocess
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from devlang_support import D, ROOT, run_bin

class AccountsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='devos-accounts-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copytree(ROOT / 'lib', self.root / 'lib')
        (self.root / 'bin').mkdir()
        shutil.copyfile(ROOT / 'bin/dev-os-accounts', self.root / 'bin/dev-os-accounts')
        self.calls = []
        self.oauth = {'access_token': 'private-token'}
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode()
                owner.calls.append((self.path, body, self.headers.get('Authorization')))
                value = {'device_code': 'private-device', 'user_code': 'ABCD-EFGH', 'interval': 5, 'expires_in': 900} if self.path.endswith('/device/code') else owner.oauth
                self.reply(value)
            def do_GET(self):
                owner.calls.append((self.path, '', self.headers.get('Authorization')))
                self.reply({'id': 123, 'login': 'tester', 'name': 'Test ไทย'})
            def reply(self, value):
                payload = json.dumps(value).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            def log_message(self, *args): pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        endpoint = 'http://127.0.0.1:' + str(self.server.server_port)
        self.endpoint = endpoint
        module = self.root / 'lib/accounts.dev'
        module.write_text(module.read_text().replace('https://github.com', endpoint).replace('https://api.github.com', endpoint))
        self.env = {'XDG_RUNTIME_DIR': str(self.root / 'run'), 'XDG_CONFIG_HOME': str(self.root / 'config'), 'DEV_OS_ROOT': str(ROOT)}
        self.pending = self.root / 'run/dev-os-accounts/pending.json'
    def request(self, action, expected=0, **kwargs):
        result = run_bin('accounts', {'action': action, **kwargs}, env=self.env, root=self.root)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return json.loads(result.stdout)
    def ready(self):
        value = json.loads(self.pending.read_text())
        value['next'] = 0
        self.pending.write_text(json.dumps(value))
    def test_guest_configuration_device_flow_and_no_token_on_disk(self):
        self.env['DEV_OS_GITHUB_CLIENT_ID'] = ''
        self.assertEqual(self.request('guest')['identity']['provider'], 'guest')
        self.request('begin', expected=1)
        self.env.pop('DEV_OS_GITHUB_CLIENT_ID')
        self.request('configure', clientId='Iv1abc')
        self.assertEqual(self.request('begin')['code'], 'ABCD-EFGH')
        self.assertTrue(self.request('poll')['pending'])
        self.assertEqual(len(self.calls), 1)
        self.ready()
        result = self.request('poll')
        self.assertEqual(result['identity']['name'], 'Test ไทย')
        self.assertFalse(self.pending.exists())
        self.assertEqual(self.calls[0][1], 'client_id=Iv1abc')
        self.assertEqual(self.calls[-1][2], 'Bearer private-token')
        for file in self.root.glob('run/**/*.json'):
            self.assertNotIn('private-token', file.read_text())
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root / 'config/dev-os/accounts.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.request('signout')['identity']['provider'], 'guest')
    def test_slowdown_denial_cancel_and_epoch_expiry(self):
        self.env['DEV_OS_GITHUB_CLIENT_ID'] = 'abc'
        self.request('begin')
        self.ready()
        self.oauth = {'error': 'slow_down'}
        self.assertEqual(self.request('poll')['interval'], 10)
        self.ready()
        self.oauth = {'error': 'access_denied'}
        self.request('poll', expected=1)
        self.assertFalse(self.pending.exists())
        self.request('begin')
        self.request('cancel')
        self.request('poll', expected=1)
        self.request('begin')
        flow = json.loads(self.pending.read_text())
        flow['expires'] = 1
        self.pending.write_text(json.dumps(flow))
        self.request('poll', expected=1)
        self.assertFalse(self.pending.exists())
    def test_invalid_client_and_json_fail_in_protocol(self):
        for value in ('abc;reboot', 'a' * 129, 'a\nb'):
            self.request('configure', expected=1, clientId=value)
        self.request('unknown', expected=1)

    def fixture_privileged_service(self):
        helpers = self.root / 'helpers'
        helpers.mkdir()
        helper = helpers / 'devos-account-admin'
        helper.write_text('#!/bin/sh\ncat > "' + str(self.root / 'privileged-input') + '"\nprintf \'{"ok":true,"username":"tester"}\\n\'\n')
        helper.chmod(0o755)
        (helpers / 'devos-account-askpass').write_text('fixture')
        sudo = helpers / 'sudo'
        sudo.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "' + str(self.root / 'privileged-args') + '"\nprintf "%s" "$SUDO_ASKPASS" > "' + str(self.root / 'askpass') + '"\nshift 2\nexec "$@"\n')
        sudo.chmod(0o755)
        module = self.root / 'lib/accounts.dev'
        text = module.read_text().replace('/usr/libexec/devos-account-', str(helpers / 'devos-account-'))
        # Force the fixture branch, including when the test runs outside WSL.
        module.write_text(text.replace('if util.wsl() {', 'if true {'))
        self.env['PATH'] = str(helpers) + ':' + os.environ['PATH']
        return helpers

    def test_administrator_request_keeps_password_off_argv(self):
        helpers = self.fixture_privileged_service()
        self.request('create-user', provider='guest', username='tester', password='private-password')
        argv = (self.root / 'privileged-args').read_text().splitlines()
        self.assertEqual(argv, ['-A', '--', str(helpers / 'devos-account-admin')])
        self.assertEqual(json.loads((self.root / 'privileged-input').read_text())['password'], 'private-password')
        self.assertEqual((self.root / 'askpass').read_text(), str(helpers / 'devos-account-askpass'))

    def test_greeter_enrollment_keeps_verified_token_out_of_ui(self):
        self.fixture_privileged_service()
        shutil.copyfile(ROOT / 'bin/dev-os-greeter-backend', self.root / 'bin/dev-os-greeter-backend')
        module = self.root / 'lib/greeter.dev'
        fixture = module.read_text().replace('https://github.com', self.endpoint).replace('https://api.github.com', self.endpoint)
        module.write_text(fixture.replace('if interval < 5 { interval = 5 }', 'if interval < 5 { interval = 0 }').replace('next: util.monotonic() + interval', 'next: util.monotonic()'))
        process = subprocess.Popen([D, str(self.root / 'bin/dev-os-greeter-backend')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=os.environ | self.env)
        def request(action, **data):
            process.stdin.write(json.dumps({'action': action, **data}) + '\n')
            process.stdin.flush()
            return json.loads(process.stdout.readline())
        try:
            self.assertFalse(request('enroll-create', provider='github', password='private-password')['ok'])
            self.assertEqual(request('enroll-begin')['code'], 'ABCD-EFGH')
            verified = request('enroll-poll')
            self.assertTrue(verified['verified'], verified)
            self.assertEqual(verified['username'], 'tester')
            self.assertNotIn('private-token', json.dumps(verified))
            created = request('enroll-create', provider='github', password='private-password')
            self.assertTrue(created['created'], created)
            self.assertNotIn('private-token', json.dumps(created))
            self.assertEqual(json.loads((self.root / 'privileged-input').read_text())['token'], 'private-token')
            self.assertFalse(request('enroll-create', provider='github', password='private-password')['ok'])
            process.stdin.close()
            process.wait(timeout=5)
        finally:
            if process.poll() is None: process.kill()
            process.wait(timeout=5)
            if not process.stdin.closed: process.stdin.close()
            process.stdout.close()
            process.stderr.close()

if __name__ == '__main__': unittest.main()
