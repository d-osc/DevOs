"""Tests for the Dev OS boot animation (distro/oe/meta-devos/recipes-devos/splash, distro/usb/init and prepare.py).

Static checks: the staged cmdline, the initramfs script and its escape hatches, the systemd units and the recipe.
Rendering checks compile devos-splash.c (host gcc, or gcc inside WSL on Windows) and render frames headlessly with
`--dump` to PPM, which is the very code path the framebuffer uses; they are skipped when no compiler is available.
Nothing here touches a framebuffer, a disk or a USB drive.
"""
import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'distro/usb'))
spec = importlib.util.spec_from_file_location('usb', ROOT / 'distro/usb/prepare.py')
usb = importlib.util.module_from_spec(spec); spec.loader.exec_module(usb)
RECIPE = ROOT / 'distro/oe/meta-devos/recipes-devos/splash'
SOURCE = RECIPE / 'files/devos-splash.c'
INIT = (ROOT / 'distro/usb/init').read_text()


def wsl_path(path):
    path = Path(path).resolve()
    drive = path.drive.rstrip(':').lower()
    return '/mnt/' + drive + '/' + '/'.join(path.parts[1:])


class Toolchain:
    """Compile and run the splash on the host, or inside WSL when the host (Windows) has no C compiler."""
    def __init__(self):
        self.compiler = shutil.which('gcc') or shutil.which('cc')
        self.wsl = None
        if not self.compiler and os.name == 'nt' and shutil.which('wsl'):
            probe = subprocess.run(['wsl', '-d', 'Ubuntu', '--', 'bash', '-c', 'command -v gcc'], capture_output=True, text=True)
            if probe.returncode == 0 and probe.stdout.strip(): self.wsl = 'Ubuntu'
        self.available = bool(self.compiler or self.wsl)

    def path(self, path):
        return wsl_path(path) if self.wsl else str(path)

    def run(self, command, check=True):
        """Run a shell command line (with paths already converted)."""
        # A script file: wsl.exe would otherwise expand $variables of a -c string before bash sees it.
        with tempfile.NamedTemporaryFile('w', suffix='.sh', delete=False, dir=ROOT / 'build' if (ROOT / 'build').is_dir() else None, newline='\n') as script:
            script.write(command + '\n')
        try:
            argv = ['wsl', '-d', self.wsl, '--', 'bash', wsl_path(script.name)] if self.wsl else ['bash', script.name]
            result = subprocess.run(argv, capture_output=True, text=True, timeout=120)
        finally:
            os.unlink(script.name)
        if check and result.returncode:
            raise AssertionError(f'{command}\n{result.stdout}\n{result.stderr}')
        return result

    def build(self, directory):
        binary = directory / 'devos-splash'
        self.run(f'gcc -O2 -Wall -Wextra -Werror -o {self.path(binary)} {self.path(SOURCE)} -lm')
        return binary

    def dump(self, binary, directory, *options):
        out = self.run(f'{self.path(binary)} --dump {self.path(directory)} {" ".join(options)}').stdout.split()
        return int(out[0]), int(out[1]), int(out[2])


def read_ppm(path):
    data = path.read_bytes()
    magic, size, depth, pixels = data.split(b'\n', 3)
    width, height = map(int, size.split())
    assert magic == b'P6' and depth == b'255' and len(pixels) == width * height * 3
    return width, height, pixels


def lit_fraction(pixels, threshold=40):
    count = sum(1 for i in range(0, len(pixels), 3) if max(pixels[i:i + 3]) > threshold)
    return count / (len(pixels) // 3)


class SplashStaticTests(unittest.TestCase):
    def test_recipe_ships_source_binary_and_units(self):
        recipe = (RECIPE / 'devos-splash_0.1.bb').read_text()
        for name in ('devos-splash.c', 'devos-splash-quit.service', 'devos-splash-text.service', 'devos-splash-shutdown.service'):
            self.assertTrue((RECIPE / 'files' / name).is_file(), name)
            self.assertIn(f'file://{name}', recipe)
        self.assertIn('${CC} ${CFLAGS} ${LDFLAGS}', recipe)
        self.assertIn('${bindir}/devos-splash', recipe)
        self.assertIn('inherit systemd', recipe)
        self.assertIn('devos-splash-quit.service', recipe.split('SYSTEMD_SERVICE:${PN}')[1].splitlines()[0])
        session = (ROOT / 'distro/oe/meta-devos/recipes-devos/session/devos-session.bb').read_text()
        self.assertRegex(session, r'RDEPENDS:\$\{PN\} = "[^"]*\bdevos-splash\b')

    def test_units_are_wired_and_safe(self):
        quit_unit = (RECIPE / 'files/devos-splash-quit.service').read_text()
        self.assertIn('WantedBy=multi-user.target', quit_unit)
        self.assertIn('After=greetd.service', quit_unit)
        self.assertIn('--quit --text', quit_unit)  # a failed login falls back to the text console
        self.assertNotIn('After=multi-user.target', quit_unit)  # would be an ordering cycle
        text_unit = (RECIPE / 'files/devos-splash-text.service').read_text()
        self.assertIn('WantedBy=rescue.target emergency.target', text_unit)
        self.assertIn('--quit --text', text_unit)
        shutdown = (RECIPE / 'files/devos-splash-shutdown.service').read_text()
        for target in ('poweroff.target', 'reboot.target', 'halt.target'): self.assertIn(target, shutdown)
        self.assertIn('Before=shutdown.target', shutdown)
        self.assertIn('--timeout', shutdown)  # never hangs the shutdown
        self.assertIn('TimeoutStartSec=', shutdown)

    def test_session_scripts_fade_the_splash_before_the_compositor(self):
        for relative in ('distro/oe/meta-devos/recipes-devos/session/files/devos-greeter',
                         'distro/oe/meta-devos/recipes-devos/session/files/devos-desktop', 'distro/usb/root-session'):
            text = (ROOT / relative).read_text()
            self.assertIn('devos-splash --quit', text, relative)
            self.assertLess(text.index('devos-splash --quit'), min(i for i in (text.find('labwc'), text.find('dev-os-session'), text.find('exec dbus-run-session')) if i >= 0), relative)
            self.assertIn('|| true', text.split('devos-splash --quit')[1].splitlines()[0], relative)  # set -e must not end the login

    def test_cmdline_is_quiet_with_splash_for_live_and_installed(self):
        for word in ('quiet', 'splash', 'loglevel=3', 'systemd.show_status=false', 'vt.global_cursor_default=0'):
            self.assertIn(word, usb.SPLASH_ARGS.split())
        build = (ROOT / 'distro/usb/prepare.py').read_text()
        self.assertIn('devos.renderer=pixman {SPLASH_ARGS}', build.split('cmdline=f')[1].splitlines()[0])
        self.assertIn('{SPLASH_ARGS}', build.split('installed_cmdline=f')[1].splitlines()[0])
        # The diagnostic suffix must not repeat the quiet options (the last duplicate would win over an edit).
        diagnostic = [line for line in build.splitlines() if 'devos.live.esp_uuid={esp_uuid}' in line and 'cmdline+=' in line][0]
        self.assertNotIn('show_status', diagnostic)
        self.assertIn('devos.live.esp_uuid=', diagnostic)  # DEVOS-LOGS still enabled

    def test_init_starts_the_splash_with_text_escape_hatches(self):
        for escape in ("*' devos.splash=0 '*", "*' debug '*", "*' systemd.show_status=1 '*"):
            self.assertIn(escape, INIT)
        self.assertIn('/bin/devos-splash --daemon', INIT)
        self.assertIn("*' splash '*)", INIT)
        # started before the first status line, so the initramfs never paints text on screen first
        self.assertLess(INIT.index('/bin/devos-splash --daemon'), INIT.index("status '[1/6] initramfs started'"))
        rescue = INIT.split('rescue() {')[1].split('\n}')[0]
        self.assertTrue(rescue.strip().startswith('splash_stop'), 'a failing boot shows text before anything else')
        self.assertIn('exec sh', rescue)
        for stage in ("'[2/6]'*", "'[4/6]'*", "'[5/6]'*"): self.assertIn(stage, INIT)
        # diagnostics keep working: boot.log, USB log storage and the DEVOS_* console markers are untouched
        for keep in ('save_logs', 'DEVOS-LOGS', 'DEVOS_LIVE_OVERLAY_READY', 'DEVOS_INSTALLED_ROOT_READY', '/run/live/boot.log'):
            self.assertIn(keep, INIT)

    def test_init_splash_block_is_valid_shell_and_honours_the_escape_hatch(self):
        sh = shutil.which('sh')
        if not sh or os.name == 'nt': self.skipTest('POSIX sh unavailable')
        block = INIT[INIT.index("case \" $(cat /proc/cmdline) \" in\n    *' devos.splash=0 '"):INIT.index('\nstatus() {')]
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / 'devos-splash'
            fake.write_text(f'#!/bin/sh\necho "$@" >>{tmp}/started\n'); fake.chmod(0o755)
            def started(cmdline):
                started_file = Path(tmp) / 'started'
                started_file.unlink(missing_ok=True)
                script = block.replace('/bin/devos-splash', str(fake)).replace('/run/devos-splash.status', f'{tmp}/status').replace('$(cat /proc/cmdline)', cmdline)
                result = subprocess.run([sh, '-c', script], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return started_file.is_file()
            self.assertTrue(started('quiet splash loglevel=3'))
            self.assertFalse(started('quiet splash devos.splash=0'))
            self.assertFalse(started('quiet splash debug'))
            self.assertFalse(started('quiet splash systemd.show_status=1'))
            self.assertFalse(started('console=tty0'), 'no splash token, no splash')

    def test_install_splash_replaces_hardlinked_binary_without_touching_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); tree = root / 'tree'; (tree / 'bin').mkdir(parents=True)
            original = root / 'original'; original.write_bytes(b'old')
            (tree / 'bin/devos-splash').hardlink_to(original)
            with patch.object(usb, 'build_splash', side_effect=lambda destination: destination.write_bytes(b'new')):
                usb.install_splash(tree)
            self.assertEqual(original.read_bytes(), b'old')
            self.assertEqual((tree / 'bin/devos-splash').read_bytes(), b'new')

    def test_prepare_and_diagnose_stage_the_splash_into_the_initramfs(self):
        build = (ROOT / 'distro/usb/prepare.py').read_text()
        self.assertEqual(build.count('install_splash('), 3)  # definition and two callers
        self.assertIn('-static', build.split('def build_splash')[1].split('def install_splash')[0])
        self.assertIn('SPLASH_SOURCE', build)
        self.assertTrue(usb.SPLASH_SOURCE.is_file())

    def test_source_has_no_raw_dependencies_and_keeps_drm_master_free(self):
        source = SOURCE.read_text()
        self.assertNotRegex(source, r'drmSetMaster|drmModeSetCrtc|libdrm|xf86drm')  # the framebuffer only: labwc stays the DRM master
        self.assertNotIn('KD_GRAPHICS', source.replace('KD_GRAPHICS would', ''))  # graphics mode left the panel black on the real laptop
        for needed in ('SIGUSR1', '30;40m', 'EV_KEY', '--timeout', '#define FPS 30'):
            self.assertIn(needed, source)
        self.assertLessEqual(len(source.splitlines()), 600)  # a small tool


class SplashRenderingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tools = Toolchain()
        if not cls.tools.available: raise unittest.SkipTest('No C compiler (gcc, or gcc inside WSL) to build devos-splash')
        cls.tmp = tempfile.TemporaryDirectory(prefix='devos-splash-test-', dir=ROOT / 'build' if (ROOT / 'build').is_dir() else None)
        cls.directory = Path(cls.tmp.name)
        cls.binary = cls.tools.build(cls.directory)
        cls.frames = cls.directory / 'frames'
        cls.width, cls.height, cls.count = cls.tools.dump(cls.binary, cls.frames, '--frames 145', '--size 1280x720')

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def frame(self, index, folder=None):
        return read_ppm((folder or self.frames) / f'frame-{index:03d}.ppm')

    def test_frame_count_and_size(self):
        self.assertEqual(self.count, 145)
        self.assertEqual(len(list(self.frames.glob('frame-*.ppm'))), 145)
        self.assertEqual((self.width, self.height), (506, 280))  # 760x420 design units scaled for 720 lines
        for index in (0, 70, 144):
            self.assertEqual(self.frame(index)[:2], (self.width, self.height))

    def test_loop_is_seamless(self):
        # 144 frames at 30 fps is exactly one 4.8 second loop: frame 144 is frame 0.
        self.assertEqual(self.frame(144)[2], self.frame(0)[2])
        self.assertNotEqual(self.frame(24)[2], self.frame(0)[2])
        self.assertEqual(self.frame(24 + 144 - 144)[2], self.frame(24)[2])

    def test_motion_is_smooth(self):
        before = self.frame(40)[2]
        changed = []
        for index in (41, 42, 43):
            after = self.frame(index)[2]
            changed.append(sum(1 for i in range(0, len(after), 3) if after[i:i + 3] != before[i:i + 3]) / (len(after) // 3))
            before = after
        for fraction in changed:
            self.assertGreater(fraction, 0.0005)  # it moves every frame ...
            self.assertLess(fraction, 0.08)       # ... but only a small part of the picture changes

    def test_only_the_arc_area_animates(self):
        _, height, first = self.frame(0)
        second = self.frame(37)[2]
        row = self.width * 3
        text_rows = slice(int(height * 0.55) * row, height * row)  # the wordmark and status line below the arc
        self.assertEqual(first[text_rows], second[text_rows])
        self.assertNotEqual(first[:int(height * 0.5) * row], second[:int(height * 0.5) * row])

    def test_oled_friendly_dark_small_and_not_white(self):
        _, _, pixels = self.frame(60)
        self.assertEqual(pixels[:3], b'\0\0\0')              # true black corners
        self.assertEqual(pixels[-3:], b'\0\0\0')
        self.assertLess(lit_fraction(pixels), 0.06)           # a small bright area
        self.assertLessEqual(max(pixels), 0xE0)               # never full white
        self.assertGreater(max(pixels[2::3]), 150)            # but the Dark 2026 accent blue (#3994BC family) is there
        mean = sum(pixels) / len(pixels)
        self.assertLess(mean, 12)

    def test_wordmark_text_and_status_line_render_in_theme_colours(self):
        width, height, pixels = self.frame(0)
        rows = range(int(height * .55), int(height * .72))
        grey = bright_blue = 0
        for y in rows:
            for x in range(width):
                r, g, b = pixels[(y * width + x) * 3:(y * width + x) * 3 + 3]
                if r > 150 and abs(r - g) < 12 and abs(g - b) < 12: grey += 1          # DEV in #bfbfbf
                if b > 150 and b - r > 60: bright_blue += 1                            # OS in the accent colour
        self.assertGreater(grey, 100)
        self.assertGreater(bright_blue, 60)
        status_rows = range(int(height * .77), int(height * .95))
        self.assertTrue(any(max(pixels[(y * width + x) * 3:(y * width + x) * 3 + 3]) > 50 for y in status_rows for x in range(width)),
                        'the status line is drawn')

    def test_status_message_changes_the_picture_and_long_text_is_clipped(self):
        other = self.directory / 'message'
        self.tools.dump(self.binary, other, '--frames 1', '--size 1280x720', '--message "Preparing the system"')
        self.assertNotEqual(self.frame(0, other)[2], self.frame(0)[2])
        long_dir = self.directory / 'long'
        self.tools.dump(self.binary, long_dir, '--frames 1', '--size 1280x720', '--message "' + 'error ' * 40 + '"')
        width, height, pixels = self.frame(0, long_dir)
        for y in range(height):  # nothing is drawn against the left or right edge of the region
            self.assertEqual(pixels[(y * width) * 3:(y * width) * 3 + 3], b'\0\0\0')
            self.assertEqual(pixels[(y * width + width - 1) * 3:(y * width + width) * 3], b'\0\0\0')

    def test_fade_in_starts_black_and_brightens(self):
        fade = self.directory / 'fade'
        self.tools.dump(self.binary, fade, '--frames 30', '--size 1280x720', '--fade')
        means = [sum(self.frame(i, fade)[2]) for i in (0, 6, 12, 24)]
        self.assertEqual(means[0], 0)
        self.assertEqual(means, sorted(means))
        self.assertLess(means[1], means[3])

    def test_scales_with_the_screen(self):
        big = self.directory / 'big'
        width, height, _ = self.tools.dump(self.binary, big, '--frames 1', '--size 2880x1800')
        self.assertGreater(width, 1200)  # a 2.8K OLED gets a proportionally larger mark
        small = self.directory / 'small'
        width, height, _ = self.tools.dump(self.binary, small, '--frames 1', '--size 800x600')
        self.assertLessEqual(width, 800)

    def test_full_screen_dump_is_centred_on_black(self):
        full = self.directory / 'full'
        self.tools.dump(self.binary, full, '--frames 1', '--size 1280x720', '--full')
        width, height, pixels = self.frame(0, full)
        self.assertEqual((width, height), (1280, 720))
        lit = [i // 3 for i in range(0, len(pixels), 3) if max(pixels[i:i + 3]) > 40]
        xs = [p % width for p in lit]; ys = [p // width for p in lit]
        self.assertLess(abs((min(xs) + max(xs)) / 2 - width / 2), 20)
        self.assertLess(abs((min(ys) + max(ys)) / 2 - height / 2), 40)

    def test_daemon_lifecycle_without_a_framebuffer(self):
        # No /dev/fb0 here: the daemon must still run, accept the quit request and clean its files up.
        binary = self.tools.path(self.binary)
        pid, ctl = '"$work/pid"', '"$work/ctl"'
        options = f'--fb /nonexistent --tty /dev/null --pid {pid} --control {ctl} --status "$work/status"'
        script = f'''set -e
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
{binary} --daemon {options} --timeout 30
for i in 1 2 3 4 5 6 7 8 9 10; do [ -s {pid} ] && break; sleep 0.2; done
daemon=$(cat {pid}); kill -0 $daemon
{binary} --daemon {options} --timeout 30   # a second start is ignored
[ "$(cat {pid})" = "$daemon" ]
[ "$(stat -c %a {ctl})" = 666 ]
{binary} --quit {options}
if kill -0 $daemon 2>/dev/null; then echo STILL-RUNNING; exit 1; fi
[ ! -e {pid} ] && [ ! -e {ctl} ]
{binary} --quit {options}   # quitting when nothing runs is not an error
{binary} --daemon {options} --timeout 1
sleep 3
[ ! -e {pid} ]    # the watchdog ended it by itself
echo LIFECYCLE-OK'''
        out = self.tools.run(script).stdout
        self.assertIn('LIFECYCLE-OK', out)


if __name__ == '__main__': unittest.main()
