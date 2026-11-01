"""Exercise the DevLang kernel helpers with real tar streams and provenance files."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from devlang_support import D, ROOT

SCRIPTS = ROOT / 'linux-kernel/scripts'


class KernelScriptsTest(unittest.TestCase):
    def run_helper(self, name, *args, success=True):
        result = subprocess.run([D, str(SCRIPTS / name), '--', *map(str, args)],
                                capture_output=True, text=True, timeout=45)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def fixture(self, root, mode='w:gz', format=tarfile.PAX_FORMAT, unsafe=None):
        source = root / 'cached source'; source.mkdir()
        archive = root / 'kernel archive.tar'
        files = {'Makefile': b'VERSION = 7\n', 'empty': b'',
                 'drivers/' + 'long-name-' * 16 + '/module.bin': bytes(range(256)) * 1100,
                 'notes/ไทย.txt': b'UTF-8 name\n'}
        with tarfile.open(archive, mode, format=format) as stream:
            for name, data in files.items():
                path = source / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
                item = tarfile.TarInfo('linux/' + name); item.size = len(data)
                stream.addfile(item, io.BytesIO(data))
            item = tarfile.TarInfo('linux/ignored-link'); item.type = tarfile.SYMTYPE
            item.linkname = 'Makefile'; stream.addfile(item)
            item = tarfile.TarInfo('linux/ignored-hardlink'); item.type = tarfile.LNKTYPE
            item.linkname = 'linux/Makefile'; stream.addfile(item)
            if unsafe:
                item = tarfile.TarInfo(unsafe); item.size = 1; stream.addfile(item, io.BytesIO(b'x'))
        return source, archive

    def test_banner_preserves_original_bytes(self):
        expected = (
            '██████╗  ███████╗ ██╗   ██╗  ██████╗  ███████╗ \n'
            '██╔══██╗ ██╔════╝ ██║   ██║ ██╔═══██╗ ██╔════╝ \n'
            '██║  ██║ █████╗   ██║   ██║ ██║   ██║ ███████╗ \n'
            '██║  ██║ ██╔══╝   ╚██╗ ██╔╝ ██║   ██║ ╚════██║ \n'
            '██████╔╝ ███████╗  ╚████╔╝  ╚██████╔╝ ███████║ \n'
            '╚═════╝  ╚══════╝   ╚═══╝    ╚═════╝  ╚══════╝ \n'
        )
        banner = self.run_helper('gen-banner.dev')
        self.assertEqual(banner, expected)
        self.assertEqual(len(banner.splitlines()), 6)
        self.assertEqual(self.run_helper('gen-banner.dev', ''), '\n' * 6)
        self.assertIn('Unsupported banner glyph', self.run_helper('gen-banner.dev', 'X', success=False))

    def test_source_streaming_formats_and_long_names(self):
        for mode, format in [('w:gz', tarfile.PAX_FORMAT), ('w:xz', tarfile.GNU_FORMAT), ('w', tarfile.PAX_FORMAT)]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                source, archive = self.fixture(Path(directory), mode, format)
                self.assertIn('Verified 4 source files', self.run_helper('verify-x2-source.dev', archive, source))
                (source / 'extra-build-output').write_text('allowed')
                self.assertIn('Verified 4', self.run_helper('verify-x2-source.dev', archive, source))

    def test_changed_missing_and_longer_cached_files_are_rejected(self):
        for data in (None, b'VERSION = 8\n', b'VERSION = 7\nextra'):
            with self.subTest(data=data), tempfile.TemporaryDirectory() as directory:
                source, archive = self.fixture(Path(directory))
                target = source / 'Makefile'
                if data is None: target.unlink()
                else: target.write_bytes(data)
                self.assertIn('Cached source differs', self.run_helper('verify-x2-source.dev', archive, source, success=False))

    def test_unsafe_paths_and_corrupt_archives_are_rejected(self):
        for unsafe in ('linux/../escape', '/absolute/escape'):
            with self.subTest(unsafe=unsafe), tempfile.TemporaryDirectory() as directory:
                source, archive = self.fixture(Path(directory), unsafe=unsafe)
                self.assertIn('Unsafe source archive path', self.run_helper('verify-x2-source.dev', archive, source, success=False))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source, archive = self.fixture(root)
            archive.write_bytes(b'not a tar file')
            self.run_helper('verify-x2-source.dev', archive, source, success=False)

    def test_manifest_preserves_contract_and_skips_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); bundle = root / 'bundle'; bundle.mkdir()
            archive = root / 'archive'; archive.write_bytes(b'source\x00archive')
            (bundle / 'Image').write_bytes(b'kernel\x00binary')
            (bundle / 'modules').mkdir()
            (bundle / 'modules/space \nไทย.ko').write_bytes(b'module')
            (bundle / 'modules/manifest.json').write_text('excluded')
            (bundle / 'link').symlink_to(bundle / 'Image')
            (bundle / 'directory-link').symlink_to(bundle / 'modules', target_is_directory=True)
            self.run_helper('verify-x2-source.dev', '--manifest', bundle, '7.3-devos', archive, 'https://example.org/source')
            record = json.loads((bundle / 'manifest.json').read_text())
            self.assertEqual(record['schemaVersion'], 1)
            self.assertEqual(record['board'], 'asus-ux3407na')
            self.assertEqual(record['architecture'], 'aarch64')
            self.assertEqual(record['release'], '7.3-devos')
            self.assertIs(record['hardwareTested'], False)
            self.assertEqual(record['source']['sha256'], hashlib.sha256(archive.read_bytes()).hexdigest())
            self.assertEqual(record['files'], {name: hashlib.sha256((bundle / name).read_bytes()).hexdigest()
                                            for name in ('Image', 'modules/space \nไทย.ko')})
            before = (bundle / 'manifest.json').read_bytes()
            self.run_helper('verify-x2-source.dev', '--manifest', bundle, '7.3-devos', archive, 'https://example.org/source')
            self.assertEqual(before, (bundle / 'manifest.json').read_bytes())


if __name__ == '__main__':
    unittest.main()
