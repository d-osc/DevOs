"""Static and simulated tests for tools/live/release-live-usb.ps1.

Nothing here builds an image, starts WSL, or touches a physical disk: the script is parsed, run with -DryRun, run
against a fake disk inventory (test hook that can never write), and its archive function runs in a temp directory.
Runs from Windows or from WSL (through powershell.exe); skipped if Windows PowerShell is unavailable.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tools/live/release-live-usb.ps1'
POWERSHELL = shutil.which('powershell.exe') or shutil.which('powershell')
if not POWERSHELL and Path('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe').exists():
    POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
IMAGE = 'devos-live-arm64-ux3407na.img'


def win(path):
    path = str(path)
    if os.name == 'nt':
        return path
    return subprocess.run(['wslpath', '-w', path], check=True, capture_output=True, text=True).stdout.strip()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def disk(number, name, bus='USB', unique=None, size=15376318464, boot=False, readonly=False):
    return {'Number': number, 'FriendlyName': name, 'UniqueId': unique or f'id-{name}', 'Size': size, 'BusType': bus,
            'IsBoot': boot, 'IsSystem': boot, 'IsReadOnly': readonly, 'LogicalSectorSize': 512, 'PartitionStyle': 'GPT',
            'Partitions': [{'PartitionNumber': 1, 'Type': 'System', 'Size': 536870912, 'FileSystem': 'FAT32', 'Label': 'OLD'}]}


@unittest.skipUnless(POWERSHELL, 'Windows PowerShell is not available')
class ReleaseScriptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.tmp = Path(self.temp.name)
        self.build = self.tmp / 'build'
        self.build.mkdir()

    def powershell(self, arguments, env=None, command=False):
        environment = dict(os.environ)
        names = []
        for key, value in (env or {}).items():
            environment[key] = win(value) if os.name == 'nt' else str(value)
            names.append(key + '/w')
        if names and os.name != 'nt':
            environment['WSLENV'] = ':'.join(filter(None, [environment.get('WSLENV', ''), *names]))
        head = [POWERSHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass']
        return subprocess.run(head + (['-Command'] if command else ['-File']) + arguments, capture_output=True, text=True,
                              env=environment, stdin=subprocess.DEVNULL, timeout=120)

    def release(self, *arguments, env=None):
        return self.powershell([win(SCRIPT), '-BuildDirectory', win(self.build), *arguments], env)

    def fake_usb(self, disks, recorded):
        inventory = self.tmp / 'inventory.json'
        inventory.write_text(json.dumps(disks))
        target = self.tmp / 'usb-target.json'
        target.write_text(json.dumps(recorded))
        return {'DEVOS_RELEASE_DISK_INVENTORY': inventory, 'DEVOS_RELEASE_USB_TARGET': target}

    def test_script_parses_and_avoids_forbidden_constructs(self):
        text = SCRIPT.read_text(encoding='utf-8')
        text.encode('ascii')
        self.assertNotIn('2>&1', text)
        command = ("$t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile('%s',[ref]$t,[ref]$e);"
                   "$bad=@($t|Where-Object{$_.Kind -in 'AndAnd','OrOr','QuestionMark','QuestionQuestion'}).Count;"
                   "Write-Output \"errors=$($e.Count) forbidden=$bad\"") % win(SCRIPT)
        result = self.powershell([command], command=True)
        self.assertIn('errors=0 forbidden=0', result.stdout, result.stdout + result.stderr)

    def test_camera_flag_exists_in_board_fixes(self):
        fixes = (ROOT / 'distro/usb/boardtools.dev').read_text(encoding='utf-8')
        self.assertIn('--enable-camera-candidate', fixes)
        self.assertIn('--enable-camera-candidate', SCRIPT.read_text(encoding='utf-8'))

    def test_dry_run_all_lists_commands_in_order_and_never_writes(self):
        result = self.release('-All', '-DryRun', '-Label', 'unit')
        output = result.stdout
        self.assertEqual(result.returncode, 0, output + result.stderr)
        order = ['tsc --noEmit', 'tests/live-usb.test.py', 'pgrep -a bitbake', 'distro/oe/build.sh --build', '-Mode prepare',
                 '-Mode diagnose', '-Mode build', '-Mode check', '-Mode export', 'live-usb-boot.dev', 'USB target validation']
        positions = [output.find(item) for item in order]
        self.assertNotIn(-1, positions, dict(zip(order, positions)))
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn('-EraseDisk1', output)
        self.assertNotIn('-Mode kernel', output, 'Kernel is opt-in')
        self.assertIn('Nothing was executed', output)
        self.assertIn('-diagnostic', output)
        self.assertEqual(list(self.build.iterdir()), [], 'dry run must not create files')
        for command in ('prepare', 'diagnose'):
            self.assertRegex(output, r'-Mode %s .*-OutputDirectory /var/tmp/devos-usb/x2-unit-\d{8}-\d{6}\b' % command)

    def test_dry_run_write_shows_gated_erase_only_when_requested(self):
        output = self.release('-Stage', 'Write', '-Write', '-DryRun').stdout
        self.assertLess(output.find('USB target validation'), output.find('-EraseDisk1'))
        self.assertIn('require the printed text', output)
        output = self.release('-Stage', 'Write', '-DryRun').stdout
        self.assertNotIn('-EraseDisk1', output)

    def test_kernel_stage_and_camera_candidate_are_opt_in(self):
        output = self.release('-Stage', 'Kernel', '-DryRun', '-CameraCandidate').stdout
        self.assertIn('-Mode kernel', output)
        self.assertIn('--enable-camera-candidate', output)
        self.assertIn('UNVERIFIED', output)
        refused = self.release('-Stage', 'Prepare', '-DryRun', '-CameraCandidate')
        self.assertNotEqual(refused.returncode, 0)
        self.assertNotIn('--enable-camera-candidate', self.release('-All', '-DryRun').stdout)

    def test_skip_and_from_select_stages(self):
        output = self.release('-All', '-DryRun', '-Skip', 'Test').stdout
        self.assertNotIn('Stage: Test', output)
        self.assertIn('Stage: QemuCheck', output)
        self.assertNotIn('Stage: QemuCheck', self.release('-All', '-DryRun', '-Skip', 'QemuCheck').stdout)
        resumed = self.release('-From', 'Check', '-DryRun').stdout
        self.assertIn('Stage: Check', resumed)
        self.assertNotIn('Stage: Image', resumed)
        self.assertNotIn('-EraseDisk1', resumed)

    def test_write_refuses_wrong_confirmation_and_unknown_disks(self):
        good = disk(1, 'Fake USB', unique='fake-1')
        recorded = {'UniqueId': 'fake-1', 'FriendlyName': 'Fake USB', 'Size': good['Size'], 'Number': 1}
        env = self.fake_usb([disk(0, 'NVMe', bus='NVMe', boot=True), good], recorded)
        target_hash = sha(env['DEVOS_RELEASE_USB_TARGET'])
        text = 'ERASE DISK 1 Fake USB 14.3 GB'
        wrong = self.release('-Stage', 'Write', '-Write', '-ConfirmErase', 'ERASE DISK 1', env=env)
        self.assertNotEqual(wrong.returncode, 0)
        self.assertIn('does not match', wrong.stdout)
        self.assertNotIn('suppressed', wrong.stdout)
        interactive = self.release('-Stage', 'Write', '-Write', env=env)
        self.assertNotEqual(interactive.returncode, 0, 'no typed text and no -ConfirmErase must not write')
        self.assertIn(text, interactive.stdout)
        right = self.release('-Stage', 'Write', '-Write', '-ConfirmErase', text, env=env)
        self.assertEqual(right.returncode, 0, right.stdout)
        self.assertIn('write is suppressed', right.stdout)
        self.assertEqual(self.release('-Stage', 'Write', env=env).returncode, 0)
        self.assertNotEqual(self.release('-Stage', 'Write', '-ConfirmErase', text, env=env).returncode, 0)
        # Another USB than the recorded one is refused without -RecordTarget.
        other = self.fake_usb([disk(0, 'NVMe', bus='NVMe', boot=True), disk(1, 'Other USB', unique='other-9')], recorded)
        refused = self.release('-Stage', 'Write', '-Write', '-ConfirmErase', 'ERASE DISK 1 Other USB 14.3 GB', env=other)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('NOT the recorded target', refused.stdout)
        self.assertNotIn('suppressed', refused.stdout)
        # -RecordTarget still needs its own typed text; the hook never edits the file.
        record_text = 'RECORD TARGET DISK 1 Other USB 14.3 GB'
        self.assertNotEqual(self.release('-Stage', 'Write', '-Write', '-RecordTarget', '-ConfirmErase', 'ERASE DISK 1 Other USB 14.3 GB',
                                         '-ConfirmRecord', 'yes', env=other).returncode, 0)
        recorded_run = self.release('-Stage', 'Write', '-Write', '-RecordTarget', '-ConfirmRecord', record_text,
                                    '-ConfirmErase', 'ERASE DISK 1 Other USB 14.3 GB', env=other)
        self.assertEqual(recorded_run.returncode, 0, recorded_run.stdout)
        self.assertIn('is not modified', recorded_run.stdout)
        self.assertEqual(sha(other['DEVOS_RELEASE_USB_TARGET']), hashlib.sha256(json.dumps(recorded).encode()).hexdigest())
        self.assertEqual(sha(env['DEVOS_RELEASE_USB_TARGET']), target_hash)

    def test_write_refuses_ambiguous_system_readonly_and_wrong_number(self):
        recorded = {'UniqueId': 'id-A', 'FriendlyName': 'A', 'Size': 15376318464, 'Number': 1}
        text = 'ERASE DISK 1 A 14.3 GB'
        cases = {
            'two usb disks': [disk(1, 'A'), disk(2, 'B')],
            'no usb disk': [disk(0, 'NVMe', bus='NVMe', boot=True)],
            'system usb': [disk(1, 'A', boot=True)],
            'read only': [disk(1, 'A', readonly=True)],
            'not disk 1': [disk(3, 'A')],
        }
        for name, disks in cases.items():
            with self.subTest(name):
                env = self.fake_usb(disks, recorded)
                result = self.release('-Stage', 'Write', '-Write', '-ConfirmErase', text, env=env)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertNotIn('suppressed', result.stdout)

    def test_confirm_erase_requires_write_switch(self):
        self.assertNotEqual(self.release('-Stage', 'Write', '-ConfirmErase', 'x', '-DryRun').returncode, 0)

    def function_text(self, name):
        command = ("$t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile('%s',[ref]$t,[ref]$e);"
                   "$a.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq '%s'},$true).Extent.Text") % (win(SCRIPT), name)
        return self.powershell([command], command=True).stdout

    def test_existing_image_is_moved_not_overwritten(self):
        (self.build / IMAGE).write_bytes(b'old image bytes')
        (self.build / 'SHA256SUMS').write_text('abc  ' + IMAGE + '\n')
        (self.build / 'candidate.json').write_text('{"old": true}')
        driver = self.tmp / 'archive.ps1'
        definition = self.function_text('Invoke-ArchiveImage')
        self.assertIn('Move-Item', definition)
        driver.write_text(definition + "\n$ErrorActionPreference='Stop'\n"
                          "try { $null = Invoke-ArchiveImage '%s' 'unit' '20261024-000000' '%s'; 'result=ok' } catch { 'result=refused' }\n"
                          % (win(self.build), IMAGE))
        result = self.powershell([win(driver)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        archived = self.build / f'before-unit-20261024-000000-{IMAGE}'
        self.assertEqual(archived.read_bytes(), b'old image bytes')
        self.assertFalse((self.build / IMAGE).exists(), 'the image slot must be free for export')
        self.assertEqual((self.build / 'before-unit-20261024-000000-SHA256SUMS').read_text(), 'abc  ' + IMAGE + '\n')
        self.assertTrue((self.build / 'before-unit-20261024-000000-candidate.json').exists())
        self.assertTrue((self.build / 'SHA256SUMS').exists(), 'sums are copied, not removed')
        self.assertIn('result=ok', result.stdout)
        empty = self.powershell([win(driver)])
        self.assertIn('No previous image', empty.stdout)
        # Recreate an image and archive again with the same label/stamp: refuses and keeps both files.
        (self.build / IMAGE).write_bytes(b'newer image')
        again = self.powershell([win(driver)])
        self.assertIn('result=refused', again.stdout)
        self.assertEqual(archived.read_bytes(), b'old image bytes')
        self.assertEqual((self.build / IMAGE).read_bytes(), b'newer image')


if __name__ == '__main__':
    unittest.main()
