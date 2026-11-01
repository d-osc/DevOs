"""Compact display queries leave file validation on every executable/write path."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from devlang_support import D, ROOT


class InventoryTest(unittest.TestCase):
    def test_real_icons_and_upstream_desktop_icons_exclude_the_generic_fallback(self):
        with tempfile.TemporaryDirectory(prefix='devos-pm-icons-') as directory:
            root = Path(directory)
            env = os.environ | {'HOME': str(root), 'DEV_ROOT': str(root / 'store'),
                                'XDG_DATA_HOME': str(root / 'data'), 'DEV_BIN_DIR': str(root / 'commands')}

            def cli(*args):
                result = subprocess.run([D, str(ROOT / 'pm-cli/main.dev'), '--', *map(str, args)],
                                        env=env, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result.stdout

            for name in ('tool', 'pictured', 'themed', 'unsafe-icon'):
                source = root / name; (source / 'bin').mkdir(parents=True)
                metadata = dict(name=name, version='1.0.0', bin={name: 'bin/main'})
                (source / 'bin/main').write_text('#!/bin/sh\necho test\n'); (source / 'bin/main').chmod(0o755)
                if name == 'pictured':
                    metadata['icon'] = 'picture.svg'
                    (source / 'picture.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>')
                if name in ('themed', 'unsafe-icon'):
                    (source / 'usr/share/applications').mkdir(parents=True)
                    icon = 'example-themed-icon' if name == 'themed' else '../../outside.svg'
                    (source / 'usr/share/applications/example.desktop').write_text(
                        f'[Desktop Entry]\nType=Application\nName=Example\nIcon={icon}\n')
                (source / 'package.json').write_text(json.dumps(metadata))
                archive = root / f'{name}.dpk'; cli('pack', source, '--output', archive); cli('install', archive)
            data = json.loads(cli('list', '--summary', '--json'))['packages']
            self.assertEqual(data['tool']['active']['displayIcon'], '')
            self.assertEqual(data['tool']['active']['softwareType'], 'package')
            self.assertTrue((root / 'data/applications/devos-package-icons/application.svg').is_file())
            self.assertTrue(Path(data['pictured']['active']['displayIcon']).is_file())
            self.assertEqual(data['pictured']['active']['softwareType'], 'app')
            self.assertEqual(data['themed']['active']['displayIcon'], 'example-themed-icon')
            self.assertEqual(data['themed']['active']['softwareType'], 'app')
            self.assertEqual(data['unsafe-icon']['active']['displayIcon'], '')
            self.assertEqual(data['unsafe-icon']['active']['softwareType'], 'package')
            # Type is derived from the active generation, including replacement and rollback.
            source = root / 'pictured'; metadata = json.loads((source / 'package.json').read_text())
            metadata['version'] = '2.0.0'; metadata.pop('icon'); (source / 'picture.svg').unlink()
            (source / 'package.json').write_text(json.dumps(metadata))
            archive = root / 'pictured-v2.dpk'; cli('pack', source, '--output', archive); cli('install', archive, '--replace')
            self.assertEqual(json.loads(cli('list', '--summary', '--json'))['packages']['pictured']['active']['softwareType'], 'package')
            cli('rollback', 'pictured')
            self.assertEqual(json.loads(cli('list', '--summary', '--json'))['packages']['pictured']['active']['softwareType'], 'app')

    def test_large_inventory_is_compact_and_cannot_bypass_integrity_checks(self):
        with tempfile.TemporaryDirectory(prefix='devos-pm-inventory-') as directory:
            root = Path(directory)
            package = root / 'source'; (package / 'bin').mkdir(parents=True)
            (package / 'package.json').write_text(json.dumps(dict(name='demo', version='1.0.0', bin={'demo': 'bin/demo'})))
            (package / 'bin/demo').write_text('#!/bin/sh\necho PACKAGE_EXECUTED\n')
            (package / 'bin/demo').chmod(0o755)
            env = os.environ | {'HOME': str(root), 'DEV_ROOT': str(root / 'store'),
                                'XDG_DATA_HOME': str(root / 'data'), 'DEV_BIN_DIR': str(root / 'commands')}

            def cli(*args, success=True):
                result = subprocess.run([D, str(ROOT / 'pm-cli/main.dev'), '--', *map(str, args)],
                                        env=env, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
                return result

            archive = root / 'demo.dpk'
            cli('pack', package, '--output', archive)
            cli('install', archive)
            registry = root / 'store/registry.json'
            data = json.loads(registry.read_text())
            active = data['packages']['demo']['active']
            count = len(active['files'])
            for index in range(10000):
                active['files'][f'lib/file-{index:05d}.dat'] = dict(size=1, sha256='0' * 64, executable=False)
            active['bytes'] += 10000
            registry.write_text(json.dumps(data))
            before = registry.read_bytes()
            result = cli('list', '--summary', '--json')
            inventory = json.loads(result.stdout)
            summary = inventory['packages']['demo']['active']
            self.assertEqual(summary['fileCount'], count + 10000)
            self.assertEqual(summary['bytes'], active['bytes'])
            self.assertNotIn('files', summary)
            self.assertLess(len(result.stdout), 8192)
            self.assertEqual(registry.read_bytes(), before)
            catalog = json.loads(cli('catalog', '--summary', '--json').stdout)
            self.assertEqual(catalog['inventory']['packages']['demo']['active'], summary)

            # Metadata can be displayed, but malformed file records never authorize
            # verification, execution, rollback or any store write.
            active['files']['lib/file-00000.dat']['sha256'] = 'invalid'
            registry.write_text(json.dumps(data)); before = registry.read_bytes()
            cli('list', '--summary', '--json')
            for args in [('verify', 'demo'), ('run', 'demo'), ('remove', 'demo'), ('rollback', 'demo')]:
                result = cli(*args, success=False)
                self.assertIn('Invalid file record', result.stdout + result.stderr)
                self.assertNotIn('PACKAGE_EXECUTED', result.stdout)
                self.assertEqual(registry.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
