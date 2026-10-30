"""Runs the real installer against a loop device backed by a sparse file (never a physical disk).

Needs root and the partitioning/filesystem tools; otherwise every test is skipped. Run it from WSL:
    wsl -d Ubuntu -u root python3 tests/installer-loop.test.py
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'bin/dev-os-install'
TOOLS = ('losetup', 'sfdisk', 'mkfs.vfat', 'mkfs.ext4', 'blkid', 'useradd', 'chpasswd', 'tar', 'mount', 'umount', 'lsblk')
GIB = 1024 ** 3
USABLE = os.geteuid() == 0 and all(shutil.which(tool) for tool in TOOLS) and Path('/dev/loop-control').exists()


def sh(*args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, **kwargs)


def make_source(path):
    for directory in ('etc', 'usr/lib/systemd', 'usr/bin', 'home', 'root', 'var/lib/dbus', 'usr/share/devos/profiles/generic'):
        (path / directory).mkdir(parents=True)
    (path / 'etc/os-release').write_text('ID=devos\nNAME="DevOs"\n')
    (path / 'usr/lib/systemd/systemd').write_text('#!/bin/sh\n')
    (path / 'usr/lib/systemd/systemd').chmod(0o755)
    (path / 'etc/passwd').write_text('root:x:0:0:root:/root:/bin/sh\n')
    (path / 'etc/shadow').write_text('root:!:19000:0:99999:7:::\n')
    (path / 'etc/shadow').chmod(0o640)
    (path / 'etc/group').write_text('root:x:0:\nwheel:x:10:\ndevos:x:1000:\nvideo:x:44:\naudio:x:29:\n')
    (path / 'usr/bin/tool').write_text('payload\n')
    (path / 'usr/bin/link').symlink_to('tool')
    for item in ('usr/bin/dev-os-install', 'usr/share/dev-os/bin/dev-os-install', 'usr/share/dev-os/data/applications/dev-os-installer.desktop', 'usr/share/dev-os/dist/org.devos.installer.js'):
        (path / item).parent.mkdir(parents=True, exist_ok=True)
        (path / item).write_text('installer\n')
    (path / 'usr/share/dev-os/src/apps/org.devos.installer').mkdir(parents=True)
    (path / 'usr/share/dev-os/src/apps/org.devos.installer/extension.json').write_text('{}\n')
    (path / 'etc/special name').write_text('keep me\n')
    (path / 'usr/share/devos/profiles/generic/profile.conf').write_text('name=generic\n')
    (path / 'var/lib/dbus/machine-id').write_text('0123456789abcdef0123456789abcdef\n')


@unittest.skipUnless(USABLE, 'Needs root, loop devices and partitioning tools')
class LoopInstallTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = Path(tempfile.mkdtemp(prefix='devos-loop-test-', dir='/var/tmp'))
        cls.image = cls.temp / 'disk.img'
        with cls.image.open('wb') as stream:
            stream.truncate(9 * GIB)
        cls.device = sh('losetup', '--find', '--show', '-P', str(cls.image)).stdout.strip()
        assert cls.device.startswith('/dev/loop'), cls.device
        cls.name = cls.device[len('/dev/'):]
        cls.source = cls.temp / 'source'
        make_source(cls.source)
        cls.efi = cls.temp / 'INSTALLED.EFI'
        cls.efi.write_bytes(b'MZ-fake-uki')
        cls.lsblk = cls.temp / 'lsblk.txt'
        cls.lsblk.write_text(f'NAME="{cls.name}" PATH="{cls.device}" TYPE="loop" SIZE="{9 * GIB}" MODEL="" TRAN="" RM="0" RO="0" '
                             'MOUNTPOINTS="" PKNAME="" FSTYPE="" LABEL=""\n')
        cls.env = {'PATH': os.environ['PATH'], 'DEVOS_INSTALL_LSBLK': str(cls.lsblk), 'DEVOS_INSTALL_LIVE_DISK': 'sdz',
                   'DEVOS_INSTALL_SOURCE': str(cls.source), 'DEVOS_INSTALL_BOOT_EFI': str(cls.efi),
                   'DEVOS_INSTALL_ALLOW_NON_LIVE': '1', 'DEVOS_INSTALL_ALLOW_LOOP': '1', 'DEVOS_INSTALL_LOG': str(cls.temp / 'install.log')}

    @classmethod
    def tearDownClass(cls):
        sh('losetup', '-d', cls.device)
        shutil.rmtree(cls.temp, ignore_errors=True)

    def install(self, **overrides):
        arguments = {'disk': self.device, 'confirm-erase': self.device, 'confirm-size': str(9 * GIB), 'username': 'dev', 'hostname': 'testbox'}
        arguments.update(overrides)
        command = ['sh', str(SCRIPT), 'run', '--password-stdin']
        for key, value in arguments.items():
            command += [f'--{key}', value]
        return subprocess.run(command, input='correct horse\n', capture_output=True, text=True, env=self.env, timeout=600)

    def test_full_install_to_a_loop_device(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('STEP 10/10 Done', result.stdout)
        self.assertIn('DONE', result.stdout)
        table = json.loads(sh('sfdisk', '--json', self.device).stdout)['partitiontable']
        self.assertEqual(table['label'], 'gpt')
        self.assertEqual(len(table['partitions']), 2)
        esp, root = table['partitions']
        self.assertEqual(esp['type'].upper(), 'C12A7328-F81F-11D2-BA4B-00A0C93EC93B')
        self.assertEqual(esp['size'] * 512, 512 * 1024 ** 2)
        self.assertEqual(root['type'].upper(), 'B921B045-1DF0-41C3-AF44-4C6F280D3FAE')
        self.assertEqual(sh('blkid', '-s', 'LABEL', '-o', 'value', self.device + 'p1').stdout.strip(), 'DEVOSESP')
        self.assertEqual(sh('blkid', '-s', 'LABEL', '-o', 'value', self.device + 'p2').stdout.strip(), 'devos-root')
        esp_uuid = sh('blkid', '-s', 'UUID', '-o', 'value', self.device + 'p1').stdout.strip()
        root_uuid = sh('blkid', '-s', 'UUID', '-o', 'value', self.device + 'p2').stdout.strip()
        mount = self.temp / 'mnt'
        mount.mkdir(exist_ok=True)
        self.assertEqual(sh('mount', '-o', 'ro', self.device + 'p2', str(mount)).returncode, 0)
        self.addCleanup(sh, 'umount', str(mount))
        fstab = (mount / 'etc/fstab').read_text()
        self.assertIn(f'UUID={root_uuid} / ext4', fstab)
        self.assertIn(f'UUID={esp_uuid} /boot/efi vfat', fstab)
        self.assertEqual((mount / 'etc/hostname').read_text().strip(), 'testbox')
        self.assertEqual((mount / 'etc/machine-id').read_text(), '', 'systemd creates a new machine id on first boot')
        self.assertFalse((mount / 'var/lib/dbus/machine-id').exists())
        self.assertEqual((mount / 'usr/bin/tool').read_text(), 'payload\n')
        self.assertEqual(os.readlink(mount / 'usr/bin/link'), 'tool')
        for item in ('usr/bin/dev-os-install', 'usr/share/dev-os/bin/dev-os-install', 'usr/share/dev-os/data/applications/dev-os-installer.desktop', 'usr/share/dev-os/dist/org.devos.installer.js', 'usr/share/dev-os/src/apps/org.devos.installer'):
            self.assertFalse((mount / item).exists(), f'{item} belongs to the Live USB only')
        self.assertEqual((mount / 'etc/special name').read_text(), 'keep me\n')
        self.assertTrue((mount / 'etc/devos/installed').is_file())
        self.assertTrue((mount / 'usr/share/devos/profiles').exists() or not Path('/usr/share/devos/profiles').exists())
        passwd = (mount / 'etc/passwd').read_text().splitlines()
        self.assertTrue(any(line.startswith('dev:x:') and line.endswith(':/home/dev:/bin/sh') for line in passwd), passwd)
        self.assertTrue((mount / 'home/dev').is_dir())
        shadow = {line.split(':')[0]: line.split(':')[1] for line in (mount / 'etc/shadow').read_text().splitlines()}
        self.assertTrue(shadow['dev'].startswith('$'), 'The password is stored hashed')
        self.assertNotIn('correct horse', (mount / 'etc/shadow').read_text())
        self.assertEqual(shadow['root'], '!', 'The root account stays locked')
        groups = (mount / 'etc/group').read_text()
        for group in ('wheel', 'devos', 'video', 'audio'):
            self.assertRegex(groups, rf'(?m)^{group}:x:\d+:.*\bdev\b')
        self.assertNotIn('correct horse', (self.temp / 'install.log').read_text())
        self.assertNotIn('correct horse', result.stdout + result.stderr)
        sh('umount', str(mount))
        self.assertEqual(sh('mount', '-o', 'ro', self.device + 'p1', str(mount)).returncode, 0)
        for entry in ('EFI/BOOT/BOOTAA64.EFI', 'EFI/DEVOS/DEVOS.EFI'):
            self.assertEqual((mount / entry).read_bytes(), b'MZ-fake-uki', entry)
        sh('umount', str(mount))
        self.assertEqual(sh('findmnt', '-n', self.device + 'p1').stdout.strip(), '', 'Everything was unmounted')
        leftovers = [p for p in Path('/run').glob('devos-install.*')]
        self.assertEqual(leftovers, [], 'The temporary mount directory is removed')

    def test_missing_boot_image_is_an_error_not_a_silent_unbootable_install(self):
        env = dict(self.env, DEVOS_INSTALL_BOOT_EFI=str(self.temp / 'missing.efi'))
        result = subprocess.run(['sh', str(SCRIPT), 'run', '--password-stdin', '--disk', self.device, '--confirm-erase', self.device,
                                 '--confirm-size', str(9 * GIB), '--username', 'dev'], input='pw\n', capture_output=True, text=True, env=env, timeout=600)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ERROR', result.stdout)
        self.assertIn('INSTALLED.EFI', result.stdout)
        self.assertNotIn('DONE', result.stdout)
        self.assertEqual(sh('findmnt', '-n', self.device + 'p2').stdout.strip(), '', 'A failed install unmounts everything')


if __name__ == '__main__':
    unittest.main()
