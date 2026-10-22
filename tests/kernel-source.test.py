import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import hashlib
from bridge_support import BridgeFixture

class Kernel:
    @staticmethod
    def digest(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
    @staticmethod
    def snapshot(destination, project):
        fixture = BridgeFixture('distro/kernel.dev')
        try:
            value = fixture.value(f'bridge.snapshot({json.dumps(str(destination))}, {json.dumps(str(project))})')
            if value is None: raise ValueError(fixture.output)
            return value
        finally: fixture.close()
kernel = Kernel()

class KernelSourceTest(unittest.TestCase):
    def fixture(self,root,archive_version='1.2.3'):
        project=root/'DevOsLinuxKernel'
        for directory in ('scripts','config','output'):(project/directory).mkdir(parents=True)
        (project/'scripts/common.sh').write_text('export KERNEL_VERSION="1.2.3"\n')
        (project/'config/kernel-fragment.config').write_text('CONFIG_LOCALVERSION="-devos"\n')
        (project/'output/kernel-1.2.3-aarch64.config').write_text('CONFIG_ARM64=y\n')
        image=bytearray(64);image[56:60]=b'ARM\x64';image.extend(b'Linux version 1.2.3-devos (compiler)\0')
        (project/'output/devos-Image-1.2.3-aarch64').write_bytes(image)
        archive=root/'linux.tar.xz'
        with tarfile.open(archive,'w:xz') as stream:
            for name,data in [('Makefile',f'VERSION = {archive_version.split(".")[0]}\nPATCHLEVEL = {archive_version.split(".")[1]}\nSUBLEVEL = {archive_version.split(".")[2]}\n'.encode()),('COPYING',b'GPL-2.0')]:
                item=tarfile.TarInfo('linux-1.2.3/'+name);item.size=len(data);stream.addfile(item,io.BytesIO(data))
        return project,archive
    def test_selected_project_snapshot_and_provenance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);project,archive=self.fixture(root)
            with patch.dict(os.environ,{'DEVOS_KERNEL_ARCHIVE':str(archive)}):
                record=kernel.snapshot(root/'payload',project)
                self.assertEqual(record['release'],'1.2.3-devos')
                self.assertEqual(record['archive_sha256'],kernel.digest(root/'payload/devos-linux.tar.xz'))
                self.assertEqual(record['image_sha256'],kernel.digest(root/'payload/devos-kernel-Image'))
                self.assertEqual(json.loads((root/'payload/devos-kernel.json').read_text())['project'],str(project))
                self.assertEqual(kernel.snapshot(root/'payload',project),record)
    def test_wrong_source_version_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);project,archive=self.fixture(root,'1.2.4')
            with patch.dict(os.environ,{'DEVOS_KERNEL_ARCHIVE':str(archive)}):
                with self.assertRaisesRegex(ValueError,'version differs'):kernel.snapshot(root/'payload',project)
    def test_wrong_architecture_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);project,archive=self.fixture(root)
            (project/'output/kernel-1.2.3-aarch64.config').write_text('CONFIG_X86_64=y\n')
            with patch.dict(os.environ,{'DEVOS_KERNEL_ARCHIVE':str(archive)}):
                with self.assertRaisesRegex(ValueError,'ARM64'):kernel.snapshot(root/'payload',project)
if __name__=='__main__':unittest.main()
