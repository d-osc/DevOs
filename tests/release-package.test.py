"""Tests for tools/release/package.py and the release workflows. Nothing here uses the network, a disk or root."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('devos_release_package', ROOT / 'tools/release/package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)
RELEASE = (ROOT / '.github/workflows/release-manual.yml').read_text(encoding='utf-8')
CI = (ROOT / '.github/workflows/ci.yml').read_text(encoding='utf-8')


def write(root, relative, text='x', binary=None):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(binary if binary is not None else text.encode())


class Tree(unittest.TestCase):
    """A small repository with every kind of file the packaging rules care about."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        write(self.root, 'package.json', json.dumps({'version': '1.2.3'}))
        write(self.root, 'dist/build-info.json', json.dumps({'version': '1.2.3'}))
        write(self.root, 'docs/releases/v1.2.3.md', '# DevOs v1.2.3\n')
        for name in ('bin/dev-os-shell', 'lib/helper.py', 'dist/shell.js', 'config/a.json', 'data/themes/dark.css',
                     'extensions/org.devos.x/extension.json', 'profiles/asus/ux3407na/profile.conf'):
            write(self.root, name, '#!/bin/sh\n' if name.startswith('bin/') else 'content')
        for name in package.RUNTIME_EXTRAS:
            write(self.root, name)
        # Everything below must never reach a runtime archive.
        for name in ('assets/font/fa-pro.woff2', 'data/icons/fa/classic-solid.json', 'data/icons/fa/NOTICE.md'):
            write(self.root, name, 'font')
        for name in ('lib/__pycache__/helper.pyc', 'lib/helper.pyc', 'bin/run.ps1', 'dist/config-test.js',
                     'dist/types/index.d.ts', 'config/.env', 'config/server.pem', 'extensions/id_rsa',
                     'node_modules/react/index.js', 'build/leftover.o', 'tests/a.test.py'):
            write(self.root, name, 'secret')
        subprocess.run(['git', 'init', '-q'], cwd=self.root, check=True)
        subprocess.run(['git', 'add', '-f', '.'], cwd=self.root, check=True)


class CheckTests(Tree):
    def fails(self, version, text):
        with contextlib.redirect_stderr(io.StringIO()) as err, self.assertRaises(SystemExit):
            package.check(version, self.root)
        self.assertIn(text, err.getvalue())

    def test_accepts_matching_version_and_notes(self):
        self.assertEqual(package.check('v1.2.3', self.root), self.root / 'docs/releases/v1.2.3.md')

    def test_rejects_malformed_versions(self):
        for version in ('1.2.3', 'v1.2', 'v1.2.3.4', 'v1.2.3-rc1', 'v01.2.3', 'v1.2.x', '', 'latest'):
            with self.subTest(version=version):
                self.fails(version, 'vMAJOR.MINOR.PATCH')

    def test_rejects_version_that_differs_from_package_json(self):
        self.fails('v1.2.4', 'does not match package.json version 1.2.3')

    def test_requires_notes(self):
        (self.root / 'docs/releases/v1.2.3.md').unlink()
        self.fails('v1.2.3', 'docs/releases/v1.2.3.md do not exist')

    def test_rejects_empty_notes(self):
        write(self.root, 'docs/releases/v1.2.3.md', '  \n')
        self.fails('v1.2.3', 'are empty')

    def test_notes_directory_is_configurable(self):
        (self.root / 'docs/releases/v1.2.3.md').rename(self.root / 'docs/v1.2.3.md')
        self.assertEqual(package.check('v1.2.3', self.root, 'docs'), self.root / 'docs/v1.2.3.md')


class FileListTests(Tree):
    def test_runtime_includes_payload_extras_and_profiles(self):
        files = package.runtime_files(self.root)
        for name in ('bin/dev-os-shell', 'lib/helper.py', 'dist/shell.js', 'config/a.json', 'data/themes/dark.css',
                     'extensions/org.devos.x/extension.json', 'profiles/asus/ux3407na/profile.conf', *package.RUNTIME_EXTRAS):
            self.assertIn(name, files)

    def test_runtime_includes_font_awesome_but_not_secrets_and_build_noise(self):
        files = package.runtime_files(self.root)
        for name in ('assets/font/fa-pro.woff2', 'data/icons/fa/classic-solid.json', 'data/icons/fa/NOTICE.md'):
            self.assertIn(name, files)
        for name in ('lib/__pycache__/helper.pyc', 'lib/helper.pyc', 'bin/run.ps1', 'dist/config-test.js', 'dist/types/index.d.ts',
                     'config/.env', 'config/server.pem', 'extensions/id_rsa', 'node_modules/react/index.js', 'build/leftover.o',
                     'tests/a.test.py'):
            self.assertNotIn(name, files)

    def test_source_archive_list_includes_font_awesome_and_excludes_secrets(self):
        files = package.source_files(self.root)
        self.assertIn('package.json', files)
        self.assertIn('tests/a.test.py', files)
        for name in ('assets/font/fa-pro.woff2', 'data/icons/fa/NOTICE.md'):
            self.assertIn(name, files)
        for name in ('config/.env', 'config/server.pem', 'extensions/id_rsa'):
            self.assertNotIn(name, files)

    def test_missing_extra_is_an_error(self):
        (self.root / 'native/devos-swap').unlink()
        with contextlib.redirect_stderr(io.StringIO()) as err, self.assertRaises(SystemExit):
            package.runtime_files(self.root)
        self.assertIn('native/devos-swap', err.getvalue())

    def test_extras_match_the_oe_prepare_recipe(self):
        text = (ROOT / 'distro/oe/prepare.dev').read_text(encoding='utf-8')
        body = text[text.index('fn buildRuntimeArchive'):]
        listed = re.search(r'let extras = Vec<str>\((.*?)\)\n', body, re.S).group(1)
        self.assertEqual(tuple(re.findall(r'"([^"]+)"', listed)), package.RUNTIME_EXTRAS)
        find = re.search(r'find ((?:\w+ )+)-type f', body).group(1).split()
        self.assertEqual(tuple(find), package.RUNTIME_DIRS)

    def test_repository_sources_include_the_font_awesome_files(self):
        try:
            files = package.source_files(ROOT)
        except subprocess.CalledProcessError:
            self.skipTest('git cannot read this checkout (a Windows worktree seen from WSL)')
        self.assertIn('package.json', files)
        self.assertIn('data/icons/fa/NOTICE.md', files)
        self.assertTrue([name for name in files if name.startswith('assets/')])


class BuildTests(Tree):
    def build(self, name):
        output = self.root / name
        with contextlib.redirect_stdout(io.StringIO()):
            return package.build('v1.2.3', output, self.root), output

    def test_build_writes_archives_and_checksums(self):
        assets, output = self.build('out')
        self.assertEqual([path.name for path in assets], ['devos-1.2.3-runtime.tar.gz', 'devos-1.2.3-source.tar.gz'])
        sums = dict(line.split('  ')[::-1] for line in (output / 'SHA256SUMS').read_text().splitlines())
        for path in assets:
            self.assertEqual(sums[path.name], hashlib.sha256(path.read_bytes()).hexdigest())
        with tarfile.open(assets[0]) as archive:
            names = archive.getnames()
            self.assertTrue(all(name.startswith('devos-runtime/') for name in names))
            self.assertIn('devos-runtime/release.json', names)
            self.assertIn('devos-runtime/profiles/asus/ux3407na/profile.conf', names)
            for name in ('assets/font/fa-pro.woff2', 'data/icons/fa/classic-solid.json', 'data/icons/fa/NOTICE.md'):
                self.assertIn('devos-runtime/' + name, names)
            self.assertFalse([name for name in names if '.env' in name or name.endswith('.pem') or '/node_modules/' in name])
            self.assertEqual(archive.getmember('devos-runtime/bin/dev-os-shell').mode, 0o755)
            self.assertEqual(archive.getmember('devos-runtime/lib/helper.py').mode, 0o644)
            self.assertEqual({member.uid for member in archive.getmembers()}, {0})
            manifest = json.loads(archive.extractfile('devos-runtime/release.json').read())
            self.assertEqual((manifest['version'], manifest['profile']), ('v1.2.3', 'asus/ux3407na'))
        with tarfile.open(assets[1]) as archive:
            names = archive.getnames()
            self.assertTrue(all(name.startswith('devos-1.2.3/') for name in names))
            self.assertIn('devos-1.2.3/assets/font/fa-pro.woff2', names)
            self.assertIn('devos-1.2.3/data/icons/fa/NOTICE.md', names)

    def test_build_is_reproducible(self):
        first, _ = self.build('one')
        second, _ = self.build('two')
        self.assertEqual([package.sha256(path) for path in first], [package.sha256(path) for path in second])

    def test_build_requires_a_matching_dist(self):
        write(self.root, 'dist/build-info.json', json.dumps({'version': '1.2.2'}))
        with contextlib.redirect_stderr(io.StringIO()) as err, self.assertRaises(SystemExit):
            package.build('v1.2.3', self.root / 'out', self.root)
        self.assertIn('rebuild', err.getvalue())

    def test_build_requires_notes(self):
        (self.root / 'docs/releases/v1.2.3.md').unlink()
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            package.build('v1.2.3', self.root / 'out', self.root)
        self.assertFalse((self.root / 'out').exists())


class WorkflowTests(unittest.TestCase):
    def job(self, name):
        match = re.search(rf'^  {name}:\n(.*?)(?=^  \w[\w-]*:\n|\Z)', RELEASE, re.S | re.M)
        self.assertIsNotNone(match, name)
        return match.group(1)

    def test_notes_directory_is_one_constant_shared_with_the_script(self):
        value = re.search(r'^  RELEASE_NOTES_DIR: (\S+)$', RELEASE, re.M).group(1)
        self.assertEqual(value, package.NOTES_DIR)
        self.assertEqual(value, 'docs/releases')
        named = [line for line in RELEASE.splitlines() if 'docs/releases' in line and not line.lstrip().startswith('#')]
        self.assertEqual(named, ['  RELEASE_NOTES_DIR: docs/releases'])
        self.assertIn('--notes-file "$RELEASE_NOTES_DIR/$RELEASE_VERSION.md"', RELEASE)

    def test_release_is_manual_with_a_required_version(self):
        head = RELEASE.split('\njobs:')[0]
        self.assertIn('workflow_dispatch:', head)
        self.assertRegex(head, r'version:\n(?:        .*\n)*?        required: true')
        self.assertNotIn('pull_request', head)
        self.assertNotIn('push:', head)

    def test_first_job_validates_the_version_and_notes_and_everything_waits_for_it(self):
        self.assertLess(RELEASE.index('\n  validate:'), RELEASE.index('\n  checks:'))
        self.assertIn('package.py check --version "$RELEASE_VERSION"', self.job('validate'))
        self.assertIn('needs: validate', self.job('checks'))
        self.assertIn('needs: checks', self.job('build'))
        self.assertIn('needs: [build, image]', self.job('publish'))

    def test_only_publish_can_write_and_user_input_is_not_interpolated_into_scripts(self):
        self.assertEqual(RELEASE.count('contents: write'), 1)
        self.assertIn('contents: write', self.job('publish'))
        self.assertRegex(RELEASE, r'(?m)^permissions:\n  contents: read$')
        runs = re.findall(r'run: [|>]?\n?(.*?)(?=\n      - |\n  \w)', RELEASE, re.S)
        self.assertFalse([run for run in runs if '${{ inputs' in run])

    def test_actions_are_pinned_to_majors(self):
        for workflow in (RELEASE, CI):
            for use in re.findall(r'uses: (\S+)', workflow):
                self.assertTrue(use.startswith('./') or re.search(r'@v\d+$', use), use)

    def test_publish_checks_sums_and_does_not_filter_font_awesome(self):
        publish = self.job('publish')
        self.assertIn('Invalid artifact checksum', publish)
        self.assertNotIn('icons/fa', publish)
        self.assertIn('gh release create "$RELEASE_VERSION" publish/* --target "$GITHUB_SHA"', publish)
        self.assertIn('--title "DevOs $RELEASE_VERSION"', publish)

    def test_release_builds_both_architectures_and_reuses_ci(self):
        self.assertIn('ubuntu-24.04-arm', RELEASE)
        self.assertIn('uses: ./.github/workflows/ci.yml', RELEASE)
        self.assertIn('workflow_call:', CI)
        self.assertRegex(CI, r'branches: \[main, ux3407na-dev\]')
        self.assertIn('ubuntu-24.04-arm', CI)

    def test_tag_and_branch_entry_point_uses_the_shared_pipeline(self):
        entry = (ROOT / '.github/workflows/release.yml').read_text(encoding='utf-8')
        self.assertIn('workflow_dispatch:', entry)
        self.assertIn("tags: ['v*']", entry)
        self.assertIn('uses: ./.github/workflows/release-manual.yml', entry)
        self.assertIn('version: ${{ inputs.version || github.ref_name }}', entry)
        self.assertIn('secrets: inherit', entry)
        self.assertIn('workflow_call:', RELEASE)
        for option in ('build_image', 'build_system_bundle', 'image_runner'):
            self.assertIn(option + ':', entry)

    def test_publish_requires_requested_assets_and_verifies_their_contents(self):
        # Execute the actual assembly step with tiny artifacts, without GitHub or an image build host.
        publish = self.job('publish')
        step = publish.split('      - name: Assemble verified assets\n', 1)[1].split('      - name:', 1)[0]
        script = __import__('textwrap').dedent(step.split('        run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'release-assets/test'
            source.mkdir(parents=True)
            names = ['dev-os-linux-x64.tar.gz', 'dev-os-linux-arm64.tar.gz',
                     'devos-1.2.3-runtime.tar.gz', 'devos-1.2.3-source.tar.gz',
                     'dev-os-patch-1.2.2-to-1.2.3-linux-arm64.tar.gz']
            def manifest():
                (source / 'SHA256SUMS').write_text(''.join(
                    hashlib.sha256((source / name).read_bytes()).hexdigest() + '  ' + name + '\n' for name in names))
            for name in names:
                (source / name).write_bytes(b'release asset')
            manifest()
            with contextlib.chdir(root), patch.dict(os.environ, RELEASE_VERSION='v1.2.3', BUILD_IMAGE='false', BUILD_SYSTEM_BUNDLE='false'):
                exec(script, {})
                self.assertTrue((root / 'publish' / names[-1]).is_file())
                shutil.rmtree(root / 'publish')
                with patch.dict(os.environ, BUILD_IMAGE='true'), self.assertRaisesRegex(SystemExit, 'Unexpected release assets'):
                    exec(script, {})
                shutil.rmtree(root / 'publish')
                with patch.dict(os.environ, BUILD_SYSTEM_BUNDLE='true'), self.assertRaisesRegex(SystemExit, 'Unexpected release assets'):
                    exec(script, {})
                shutil.rmtree(root / 'publish')
                names += ['devos-live-1.2.3-arm64-ux3407na.img.zst.part-00', 'IMAGE-INFO.txt',
                          'dev-os-system-linux-arm64.tar.gz', 'dev-os-system-linux-arm64.json']
                for name in names[-4:]:
                    (source / name).write_bytes(b'image or system asset')
                manifest()
                with patch.dict(os.environ, BUILD_IMAGE='true', BUILD_SYSTEM_BUNDLE='true'):
                    exec(script, {})
                sums = (root / 'publish/SHA256SUMS').read_text()
                for name in names:
                    self.assertIn('  ' + name + '\n', sums)
                shutil.rmtree(root / 'publish')
                (source / names[0]).write_bytes(b'corrupted')
                with self.assertRaisesRegex(SystemExit, 'Invalid artifact checksum'):
                    exec(script, {})

    def test_workflows_are_valid_yaml(self):
        try:
            import yaml
        except ImportError:
            self.skipTest('PyYAML is not installed')
        for name in ('release-manual.yml', 'ci.yml', 'release.yml'):
            data = yaml.safe_load((ROOT / '.github/workflows' / name).read_text(encoding='utf-8'))
            self.assertIn('jobs', data, name)
        data = yaml.safe_load(RELEASE)
        self.assertEqual(set(data['jobs']), {'validate', 'checks', 'build', 'image', 'publish'})
        self.assertEqual(data[True]['workflow_dispatch']['inputs']['version']['required'], True)

    def test_nothing_excludes_font_awesome(self):
        for path in ('tools/build/release.ts', 'tools/release/package.py', '.github/workflows/release.yml', '.github/workflows/ci.yml'):
            self.assertNotRegex((ROOT / path).read_text(encoding='utf-8'), r"!\s*source\.(includes|endsWith)\('/data/icons|EXCLUDED_PREFIXES", path)

    def test_notes_for_the_checked_in_version_exist_and_readme_explains_the_process(self):
        version = package.package_version(ROOT)
        notes = ROOT / package.NOTES_DIR / f'v{version}.md'
        self.assertTrue(notes.is_file(), notes)
        self.assertIn(f'# DevOs v{version}', notes.read_text(encoding='utf-8'))
        readme = (ROOT / package.NOTES_DIR / 'README.md').read_text(encoding='utf-8')
        for text in ('RELEASE_NOTES_DIR', 'Font Awesome', 'workflow', 'package.json'):
            self.assertIn(text, readme)


if __name__ == '__main__':
    unittest.main()
