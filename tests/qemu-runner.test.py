import json
import unittest
from bridge_support import BridgeFixture

class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.bridge = BridgeFixture('distro/qemu.dev'); self.addCleanup(self.bridge.close)

    def test_temporary_desktop_disk_and_user_network(self):
        args = self.bridge.value('bridge.plan("desktop", "/tmp/Image", "/tmp/disk,file.ext4", "", "/tmp/serial.log", 4096, 2, false, false)')
        drive = args[args.index('-drive') + 1]
        for part in ('snapshot=on', 'format=raw', 'disk,,file.ext4'): self.assertIn(part, drive)
        self.assertIn('user,id=net0', args)
        self.assertNotIn('hostfwd', str(args)); self.assertNotIn('tap', str(args))
        self.assertIn('devos.renderer=pixman', args[args.index('-append') + 1])

    def test_base_smoke_and_interactive_console(self):
        args = self.bridge.value('bridge.plan("base", "/tmp/Image", "", "/tmp/initrd", "/tmp/log", 512, 2, false, true)')
        self.assertIn('devos.smoke=1', args[-1]); self.assertIn('none', args)
        self.assertFalse(self.bridge.value('bridge.bootReady("base", "Linux 7.2.11-devos DEVOS_BASE_SMOKE_PASS", "7.2.11-devos")'))
        self.assertTrue(self.bridge.value('bridge.bootReady("base", "Linux 7.2.11-devos DEVOS_BASE_SMOKE_PASS reboot: Power down", "7.2.11-devos")'))

    def test_desktop_boot_markers_and_panic(self):
        text = 'Linux 7.2.11-devos\nStarted greetd.service - Greeter daemon\nReached target graphical.target - Graphical Interface\nlogin:'
        for output, release, expected in [(text, '7.2.11-devos', True), (text + 'Kernel panic', '7.2.11-devos', False), (text, '7.2.12-devos', False), (text.replace('login:', ''), '7.2.11-devos', False)]:
            self.assertEqual(self.bridge.value(f'bridge.bootReady("desktop", {json.dumps(output)}, {json.dumps(release)})'), expected)

    def test_kernel_image_architecture(self):
        image = self.bridge.root / 'Image'
        data = bytearray(64); data[56:60] = b'ARM\x64'; data.extend(b'Linux version 7.2.11-devos (compiler)'); image.write_bytes(data)
        self.assertEqual(self.bridge.value(f'bridge.kernelRelease({json.dumps(str(image))})'), '7.2.11-devos')
        image.write_bytes(b'not an ARM kernel')
        self.assertEqual(self.bridge.value(f'bridge.kernelRelease({json.dumps(str(image))})'), '')

    def test_missing_image_instructs_build(self):
        self.assertEqual(self.bridge.value(f'bridge.newestRootfs({json.dumps(str(self.bridge.root))})'), '')
        self.assertIn('desktop-build', self.bridge.output)

    def inspection(self, replies):
        file = self.bridge.root / 'calls'
        self.bridge.replace('capture', f'fn capture(command: str): str {{ let count = fs.existsSync({json.dumps(str(file))}) ? strings.split(fs.readFileSync({json.dumps(str(file))}, "utf8"), "\\n").len() as i64 - 1 : 0; fs.appendFileSync({json.dumps(str(file))}, command + "\\n"); let replies = json.parse({json.dumps(json.dumps(replies))}); return json.string(json.at(replies, count)) }}')
        return file

    def test_os_release_symlink_falls_back(self):
        file = self.inspection(['/usr/sbin/debugfs', '', 'ID="devos"\n', 'Inode: 42 Type: directory'])
        self.assertTrue(self.bridge.value('bridge.inspectRootfs("/tmp/image.ext4", "7.2.11-devos")'))
        self.assertIn('cat /usr/lib/os-release', file.read_text())

    def test_foreign_os_not_overridden_by_fallback(self):
        file = self.inspection(['/usr/sbin/debugfs', 'ID=ubuntu\n'])
        self.assertFalse(self.bridge.value('bridge.inspectRootfs("/tmp/image.ext4", "7.2.11-devos")'))
        self.assertEqual(len(file.read_text().splitlines()), 2)

    def test_mismatched_modules_rejected_without_mounting(self):
        file = self.inspection(['/usr/sbin/debugfs', 'ID=devos\n', '', ''])
        self.assertFalse(self.bridge.value('bridge.inspectRootfs("/tmp/image.ext4", "7.2.11-devos")'))
        self.assertIn('Rebuild kernel and rootfs', self.bridge.output)
        self.assertTrue(all('debugfs' in command for command in file.read_text().splitlines()))

if __name__ == '__main__': unittest.main()
