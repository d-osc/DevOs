"""Installer safety: disk selection, argument validation and refusals. Nothing here writes to a disk."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'bin/dev-os-install'
FIXTURE = ROOT / 'tests/fixtures/installer/lsblk-mixed.txt'
# The installer runs on the full Live system, whose /bin/sh supports arithmetic expansion (the tiny initramfs
# BusyBox does not and never runs it). Check both dash-style sh and bash.
SHELLS = [['sh']] + ([['bash']] if shutil.which('bash') else [])


def run(args, shell=('sh',), env=None, stdin='', source=None):
    environment = {'PATH': os.environ['PATH'], 'DEVOS_INSTALL_LSBLK': str(FIXTURE), 'DEVOS_INSTALL_LIVE_DISK': 'sdb'}
    if source:
        environment['DEVOS_INSTALL_SOURCE'] = str(source)
    environment.update(env or {})
    return subprocess.run([*shell, str(SCRIPT), *args], input=stdin, capture_output=True, text=True, env=environment, timeout=60)


def fake_source(directory):
    source = Path(directory) / 'source'
    (source / 'etc').mkdir(parents=True)
    (source / 'etc/os-release').write_text('ID=devos\nNAME="DevOs"\n')
    return source


class DiskSelectionTests(unittest.TestCase):
    def test_only_safe_internal_disks_are_offered(self):
        for shell in SHELLS:
            result = run(['disks', '--json'], shell)
            self.assertEqual(result.returncode, 0, result.stderr)
            disks = json.loads(result.stdout)
            self.assertEqual([disk['name'] for disk in disks], ['nvme0n1', 'vda'], shell)
            nvme = disks[0]
            self.assertEqual((nvme['path'], nvme['transport'], nvme['removable']), ('/dev/nvme0n1', 'nvme', False))
            self.assertEqual(nvme['model'], 'WDC PC SN740')
            self.assertEqual(nvme['contents'], 'ntfs,vfat', 'Existing data is reported so the user can be warned')

    def test_excluded_disks(self):
        offered = {disk['name'] for disk in json.loads(run(['disks', '--json']).stdout)}
        for name, why in (('sdb', 'the Live USB'), ('sdc', 'too small'), ('sdd', 'read-only'), ('sde', 'has a mounted partition'),
                          ('zram0', 'active swap'), ('sr0', 'optical'), ('loop0', 'loop device')):
            self.assertNotIn(name, offered, why)

    def test_text_listing(self):
        lines = run(['disks']).stdout.strip().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith('/dev/nvme0n1\t'))


class PlanAndRefusalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = fake_source(self.temp.name)

    def refused(self, args, message, **kwargs):
        result = run(args, source=self.source, **kwargs)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('ERROR', result.stdout)
        self.assertIn(message, result.stdout)
        self.assertNotIn('STEP', result.stdout, 'No step may start when a check fails')

    def test_plan_describes_erase_and_confirmation(self):
        for shell in SHELLS:
            result = run(['plan', '--disk', '/dev/nvme0n1', '--username', 'dev'], shell, source=self.source)
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertIn('ERASE /dev/nvme0n1', result.stdout)
            self.assertIn('--confirm-size 549755813888', result.stdout)
            self.assertIn('/dev/nvme0n1p1', result.stdout)
            self.assertIn('/dev/nvme0n1p2', result.stdout)

    def test_plan_refuses_unsafe_targets(self):
        for disk, message in (('/dev/sdb', 'Live USB'), ('/dev/sde', 'mounted'), ('/dev/sdd', 'not a suitable'),
                              ('/dev/sdc', 'not a suitable'), ('/dev/sdz', 'was not found')):
            self.refused(['plan', '--disk', disk], message)

    def test_plan_refuses_partitions_and_odd_paths(self):
        for disk in ('/dev/nvme0n1p1', '/dev/sdb1', 'nvme0n1', '/dev/nvme0n1; rm -rf /', '/dev/../etc', ''):
            self.refused(['plan', '--disk', disk], 'Not a whole-disk device path')

    def test_run_requires_every_confirmation(self):
        base = ['run', '--disk', '/dev/nvme0n1', '--username', 'dev', '--password-stdin']
        env = {'DEVOS_INSTALL_ALLOW_NON_LIVE': '1'}
        if os.geteuid() != 0:
            self.skipTest('The confirmation checks run after the root check')
        self.refused(base + ['--confirm-erase', '/dev/vda', '--confirm-size', '549755813888'], 'Confirmation does not match',
                     env=env, stdin='pw\n')
        self.refused(base + ['--confirm-erase', '/dev/nvme0n1', '--confirm-size', '1'], 'size confirmation', env=env, stdin='pw\n')
        self.refused(['run', '--disk', '/dev/nvme0n1', '--username', 'dev', '--confirm-erase', '/dev/nvme0n1',
                      '--confirm-size', '549755813888'], 'standard input', env=env)
        self.refused(base + ['--confirm-erase', '/dev/nvme0n1', '--confirm-size', '549755813888'], 'cannot be empty', env=env, stdin='\n')

    def test_run_is_refused_without_root(self):
        if os.geteuid() == 0:
            self.skipTest('The non-root refusal needs an unprivileged user')
        self.refused(['run', '--disk', '/dev/nvme0n1', '--username', 'dev', '--password-stdin', '--confirm-erase', '/dev/nvme0n1',
                      '--confirm-size', '549755813888'], 'must run as root', stdin='pw\n')

    def test_run_is_refused_outside_the_live_session(self):
        # No test hooks: a normal system has no Live marker, so nothing may be erased.
        if os.geteuid() != 0:
            self.skipTest('Needs root to reach the Live-session check')
        self.refused(['run', '--disk', '/dev/nvme0n1', '--username', 'dev', '--password-stdin', '--confirm-erase', '/dev/nvme0n1',
                      '--confirm-size', '549755813888'], 'only runs from the Live USB', stdin='pw\n')

    def test_names_are_validated(self):
        for username in ('Root', '1abc', 'a b', 'x;y', '', 'a' * 40):
            self.refused(['run', '--disk', '/dev/nvme0n1', '--username', username, '--password-stdin'], 'Invalid user name', stdin='pw\n')
        self.refused(['plan', '--disk', '/dev/nvme0n1', '--hostname', 'bad host'], 'Invalid host name')

    def test_source_must_be_a_devos_root(self):
        (self.source / 'etc/os-release').write_text('ID=ubuntu\n')
        self.refused(['plan', '--disk', '/dev/nvme0n1'], 'not a Dev OS root')


class IntegrationTests(unittest.TestCase):
    """The installer is useless unless the image ships its tools and the Live USB carries a bootable installed-system image."""

    def test_image_ships_the_installer_tools(self):
        recipe = (ROOT / 'distro/oe/meta-devos/recipes-devos/shell/devos-shell_0.3.7.bb').read_text()
        depends = recipe.split('RDEPENDS:${PN} = "', 1)[1].split('"', 1)[0].split()
        for package in ('util-linux-sfdisk', 'util-linux-blkid', 'util-linux-lsblk', 'util-linux-findmnt', 'util-linux-findfs',
                        'dosfstools', 'e2fsprogs-mke2fs', 'tar', 'shadow', 'efibootmgr'):
            self.assertIn(package, depends)
        self.assertIn('bin/*', recipe, 'Every script in bin/ is installed, including dev-os-install')

    def test_live_usb_builds_the_installed_system_boot_image(self):
        prepare = (ROOT / 'distro/usb/usbimage.dev').read_text()
        self.assertIn('EFI/DEVOS/INSTALLED.EFI', prepare)
        self.assertIn('devos.root=LABEL=devos-root', prepare)
        installed = [line for line in prepare.splitlines() if 'devos.root=LABEL=devos-root' in line][0]
        self.assertNotIn('devos.live.uuid', installed, 'The installed system must not boot as Live')
        self.assertIn('INSTALLED.EFI', SCRIPT.read_text())

    def test_initramfs_has_an_installed_boot_path_without_the_live_overlay(self):
        init = (ROOT / 'distro/usb/init').read_text()
        branch = init.split('if [ -n "$root_spec" ]; then', 1)[1].split(chr(10) + 'fi' + chr(10), 1)[0]
        self.assertIn('mount -t ext4 -o rw', branch)
        self.assertIn('switch_root /newroot /sbin/init', branch)
        for live_only in ('mount -t overlay', 'shadow.live', 'greetd-root.toml', 'root-session'):
            self.assertNotIn(live_only, branch, 'The installed branch must not apply Live-only setup')
        self.assertLess(init.index('if [ -n "$root_spec" ]; then'), init.index('mount -t overlay'))

    def test_launcher_entry_and_command_exist(self):
        entry = (ROOT / 'data/applications/dev-os-installer.desktop').read_text()
        self.assertIn('Exec=dev-os-shell installer', entry)
        self.assertIn("'installer'", (ROOT / 'src/main.ts').read_text())
        self.assertIn("'installer'", (ROOT / 'packages/shell/index.ts').read_text())


if __name__ == '__main__':
    unittest.main()
