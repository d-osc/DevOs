import json
import os
from pathlib import Path
import subprocess
import unittest
from devlang_support import D, ROOT
from native_support import NativeFixture

class NativeServiceTests(unittest.TestCase):
    def setUp(self):
        self.fixture = NativeFixture().__enter__()
        self.addCleanup(self.fixture.__exit__)

    def invoke(self, name, raw=b'', env=None):
        entry = self.fixture.root / name
        source = 'devos-account-admin' if name == 'devos-account-setup' else name
        content=(ROOT / 'native' / source).read_text().replace('/usr/share/dev-os/', str(self.fixture.root) + '/')
        shell=content.startswith('#!/bin/sh')
        entry.write_text(content.replace('/usr/bin/d',D) if shell else content)
        argv = ['/bin/sh' if shell else D, str(entry)]
        if os.environ.get('DEVLANG_ENGINE') and not shell:
            argv += ['--engine', os.environ['DEVLANG_ENGINE']]
        return subprocess.run(argv, input=raw, capture_output=True, env=os.environ | (env or {}), timeout=20)

    def test_admin_protocol_rejects_malformed_oversized_and_nonroot(self):
        self.fixture.replace('privileged', 'root', 'fn root(): bool { return false }')
        for name, limit in [('devos-account-admin', 16384), ('devos-app-store-admin', 65535)]:
            for raw, message in [(b'{bad', 'Invalid JSON'), (b'x' * (limit + 1), 'too large'), (b'{}', 'Administrator')]:
                result = self.invoke(name, raw)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn(message, json.loads(result.stdout)['error'])
                self.assertFalse(json.loads(result.stdout)['ok'])

    def test_pam_is_silent_and_fails_closed(self):
        for raw, env in [(b'secret', {'PAM_TYPE': 'account', 'PAM_USER': 'root'}), (b'bad\xff', {'PAM_TYPE': 'auth', 'PAM_USER': 'root'}), (b'x' * 8193, {'PAM_TYPE': 'auth', 'PAM_USER': 'root'})]:
            result = self.invoke('devos-pam-auth', raw, env)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, b'')
            self.assertEqual(result.stderr, b'')

    def test_setup_endpoint_selects_one_time_provisioning_policy(self):
        self.fixture.replace('devos_accounts_system', 'administer', 'fn administer(request: json.Value, setup: bool): json.Value { return {setup: setup} }')
        for endpoint, expected in [('devos-account-admin', False), ('devos-account-setup', True)]:
            result = self.invoke(endpoint, b'{}')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), {'ok': True, 'setup': expected})

    def test_sudo_askpass_prompt_reaches_devlang_after_separator(self):
        mock=self.fixture.root/'mock-gjs'
        mock.write_text('#!/bin/sh\nprintf "fixture-password\\n"\n'); mock.chmod(0o700)
        file=self.fixture.root/'native/devos-account-askpass.dev'
        file.write_text(file.read_text().replace('/usr/bin/gjs',str(mock)))
        entry=self.fixture.root/'askpass'
        entry.write_text((ROOT/'native/devos-account-askpass').read_text().replace('/usr/bin/d',D).replace('/usr/share/dev-os/',str(self.fixture.root)+'/'))
        result=subprocess.run(['/bin/sh',str(entry),"Password ' ; $(not-a-command):"],capture_output=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout,b'fixture-password\n')
        self.assertEqual(result.stderr,b'')

    def test_pam_strips_only_trailing_nul_and_passes_credential_on_stdin(self):
        self.fixture.replace('devos_accounts_system', 'authenticate', 'fn authenticate(username: str, credential: str): bool { return strings.equal(username, "alice") && strings.equal(credential, "private-token") }')
        result = self.invoke('devos-pam-auth', b'private-token\0\0', {'PAM_TYPE': 'auth', 'PAM_USER': 'alice'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, b'')

    @unittest.skipUnless(os.geteuid() == 0, 'Requires root-owned fixture files; run in WSL as root.')
    def test_trusted_descriptor_rejects_symlink_directory_and_writable_files(self):
        file = self.fixture.root / 'trusted'
        file.write_text('safe')
        file.chmod(0o644)
        expression = lambda path: f'return json.get({{text: secure.trusted({json.dumps(str(path))})}}, "text")'
        self.assertEqual(self.fixture.invoke(expression(file)), {'value': 'safe'})
        link = self.fixture.root / 'link'
        link.symlink_to(file)
        self.assertIn('error', self.fixture.invoke(expression(link)))
        self.assertIn('error', self.fixture.invoke(expression(self.fixture.root)))
        for mode in (0o664, 0o646, 0o666):
            file.chmod(mode)
            self.assertIn('error', self.fixture.invoke(expression(file)))
        file.chmod(0o644)
        os.chown(file, 65534, -1)
        self.assertIn('error', self.fixture.invoke(expression(file)))

    @unittest.skipUnless(os.geteuid() == 0, 'Requires root-owned fixture state.')
    def test_atomic_registry_save_and_lock_descriptor(self):
        file = self.fixture.root / 'accounts.json'
        result = self.fixture.invoke(f'let fd = secure.lock({json.dumps(str(file) + ".lock")}); secure.save({json.dumps(str(file))}, "saved\\n"); secure.unlock(fd); return json.get({{text: secure.trusted({json.dumps(str(file))})}}, "text")')
        self.assertEqual(result, {'value': 'saved\n'})
        self.assertEqual(file.stat().st_mode & 0o777, 0o644)
        self.assertEqual(sorted(p.name for p in self.fixture.root.glob('accounts.json*')), ['accounts.json', 'accounts.json.lock'])

    def test_package_spawn_preserves_arguments_and_reports_failures(self):
        result = self.fixture.invoke('return json.get({text: secure.packageRun(Vec<str>("/usr/bin/printf", "%s", "literal ; $(not-a-command) ภาษาไทย"))}, "text")')
        self.assertEqual(result, {'value': 'literal ; $(not-a-command) ภาษาไทย'})
        self.assertIn('Native package operation failed', self.fixture.invoke('return json.get({text: secure.packageRun(Vec<str>("/usr/bin/false"))}, "text")')['error'])

    @unittest.skipUnless(os.geteuid() == 0, 'Requires root-owned store fixtures.')
    def test_store_admin_end_to_end_with_private_opkg_fixture(self):
        catalog = self.fixture.root / 'catalog.json'
        conf = self.fixture.root / 'opkg.conf'
        command = self.fixture.root / 'opkg'
        log = self.fixture.root / 'opkg.log'
        catalog.write_text(json.dumps({'schemaVersion': 1, 'source': {'name': 'Fixture', 'url': 'https://repo.example/feed'}, 'apps': [{'id': 'example', 'name': 'Example', 'package': 'devos-example'}]}))
        conf.write_text('option check_signature 1\nsrc/gz devos-app-store https://repo.example/feed\n')
        command.write_text(f'#!/bin/sh\nprintf "%s\\n" "$*" >> "{log}"\ncase "$3" in list-installed) printf "devos-example - 1.0\\n";; list-upgradable) printf "devos-example - 2.0\\n";; esac\n')
        command.chmod(0o700)
        for name, value in [('catalogPath', catalog), ('confPath', conf), ('executable', command)]:
            self.fixture.replace('devos_app_store', name, f'fn {name}(): str {{ return {json.dumps(str(value))} }}')
        self.fixture.replace('devos_app_store', 'native', 'fn native(): bool { return true }')
        result = self.invoke('devos-app-store-admin', b'{"action":"install","id":"example"}')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        state = json.loads(result.stdout)
        self.assertTrue(state['ok'])
        self.assertEqual(state['installed'][0]['version'], '1.0')
        self.assertEqual(state['updates'][0]['version'], '2.0')
        self.assertEqual([line.split(str(conf) + ' ')[1] for line in log.read_text().splitlines()], ['update', 'install devos-example', 'list-installed', 'list-upgradable'])
        before = log.read_text()
        result = self.invoke('devos-app-store-admin', b'{"action":"remove","id":"--all"}')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(log.read_text(), before)

    def test_native_contains_no_python_implementation(self):
        self.assertFalse(list((ROOT / 'native').glob('*.py')))
        for file in (ROOT / 'native').iterdir():
            if file.is_file():
                self.assertNotIn(b'#!/usr/bin/python', file.read_bytes())

if __name__ == '__main__':
    unittest.main()
