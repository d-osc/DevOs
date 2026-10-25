"""Tests for the boot animation hand-off: milestones, timeouts, the Wayland splash window and the wiring that reports them.

The animation keeps running until the greeter or the shell says it is ready. Milestones are empty files in a sticky directory
(`devos-splash --step NAME`): system, session, compositor, window, shell, ready. These tests run the real daemon without a
framebuffer (the display part is covered by tests/splash.test.py) against fake run directories.
"""
import importlib.util
import re
import subprocess
import tempfile
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('splash_tests', ROOT / 'tests/splash.test.py')
splash = importlib.util.module_from_spec(spec); spec.loader.exec_module(splash)

RECIPE = ROOT / 'distro/oe/meta-devos/recipes-devos/splash'
FILES = RECIPE / 'files'
SESSION = ROOT / 'distro/oe/meta-devos/recipes-devos/session/files'


class MilestoneWiringTests(unittest.TestCase):
    def test_every_session_entry_reports_its_milestone(self):
        for path in (SESSION / 'devos-greeter', SESSION / 'devos-desktop', ROOT / 'distro/usb/root-session'):
            text = path.read_text()
            self.assertIn('devos-splash --step session', text, path.name)
            line = [l for l in text.splitlines() if 'devos-splash --step session' in l][0]
            self.assertIn('|| true', line, 'a missing splash must never fail the login (set -e)')
            self.assertNotIn('devos-splash --quit', text, 'the splash is no longer ended when the session starts')

    def test_greeter_and_shell_say_when_they_are_ready(self):
        login = (ROOT / 'src/login.tsx').read_text()
        self.assertIn("devos-splash --step ready", login)
        self.assertLess(login.index('window.show_all()'), login.index('devos-splash --step ready'))
        self.assertIn('try {', login.split('devos-splash --step ready')[0].splitlines()[-1])  # never throws
        shell = (ROOT / 'packages/shell/index.ts').read_text()
        self.assertIn("splashStep('shell')", shell)
        self.assertIn("splashStep('ready')", shell)
        self.assertLess(shell.index("splashStep('shell')"), shell.index("splashStep('ready')"))
        self.assertIn('catch', shell.split('function splashStep')[1].split('\n}')[0])  # fire-and-forget

    def test_compositor_start_launches_the_window_splash_when_enabled(self):
        for text in ((ROOT / 'bin/dev-os-start').read_text(), (SESSION / 'devos-greeter').read_text()):
            self.assertIn('devos-splash-window.js', text)
            self.assertIn('devos-splash --step compositor', text)
            self.assertRegex(text, r'gjs -m [^\n]*(devos-splash-window\.js|\$splash_window)[^\n]*&')  # background, never awaited
        start = (ROOT / 'bin/dev-os-start').read_text()
        for escape in ("*' devos.splash=0 '*", "*' debug '*", "*' systemd.show_status=1 '*", "*' splash '*)"):
            self.assertIn(escape, start)  # the same escape hatches as the initramfs
        self.assertIn('DEVOS_SPLASH_STEPS', start)  # a post-login session has its own milestone directory

    def test_recipe_installs_window_units_and_dependencies(self):
        recipe = (RECIPE / 'devos-splash_0.1.bb').read_text()
        for name in ('devos-splash-window.js', 'devos-splash-system.service'):
            self.assertTrue((FILES / name).is_file(), name)
            self.assertIn(f'file://{name}', recipe)
        self.assertIn('${libexecdir}/devos-splash-window.js', recipe)
        self.assertRegex(recipe, r'RDEPENDS:\$\{PN\} = "[^"]*\bgjs\b[^"]*\bgtk\+3\b')
        system = (FILES / 'devos-splash-system.service').read_text()
        self.assertIn('ConditionPathExists=/run/devos-splash.d', system)  # nothing happens without the boot splash
        self.assertIn('ExecStart=-/usr/bin/devos-splash --step system', system)  # a '-' prefix: never a failed unit
        self.assertIn('WantedBy=basic.target', system)
        self.assertNotIn('After=basic.target', system)
        quit_unit = (FILES / 'devos-splash-quit.service').read_text()
        self.assertIn('sleep 150', quit_unit)  # a backstop only: the milestones end the animation
        self.assertIn('--quit --text', quit_unit)

    def test_window_script_is_generated_from_the_c_font_and_follows_the_protocol(self):
        generated = (FILES / 'devos-splash-window.js').read_text()
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp)
            for name in ('generate-window.py', 'devos-splash-window.js.in', 'devos-splash.c'): (copy / name).write_bytes((FILES / name).read_bytes())
            subprocess.run(['python3' if not splash.os.name == 'nt' else 'python', str(copy / 'generate-window.py')], check=True)
            self.assertEqual((copy / 'devos-splash-window.js').read_text(), generated, 'run generate-window.py after changing the font or the template')
        rows = re.findall(r'\{((?:0x[0-9A-Fa-f]{2},?){5})\}', (FILES / 'devos-splash.c').read_text().split('FONT[95][5] = {')[1].split('};')[0])
        self.assertEqual(len(rows), 95)
        for status in ('Starting services', 'Starting desktop', 'Loading shell', 'Almost ready'): self.assertIn(status, generated)
        for name in ('system', 'session', 'compositor', 'window', 'shell', 'ready'): self.assertIn(f"'{name}'", generated)
        self.assertIn('FADE_OUT = 0.3', generated)                       # ~300 ms fade
        self.assertIn('WATCHDOG', generated)                              # never stays up forever
        self.assertIn('Gdk.KEY_Escape', generated)                       # Esc closes it
        self.assertIn('/window', generated)                              # announces its first frame
        self.assertIn('System.exit(0)', generated)                       # no splash directory: nothing to show


class MilestoneDaemonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tools = splash.Toolchain()
        if not cls.tools.available: raise unittest.SkipTest('No C compiler (gcc, or gcc inside WSL) to build devos-splash')
        cls.tmp = tempfile.TemporaryDirectory(prefix='devos-splash-ms-', dir=ROOT / 'build' if (ROOT / 'build').is_dir() else None)
        cls.binary = cls.tools.build(Path(cls.tmp.name))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def script(self, body):
        binary = self.tools.path(self.binary)
        head = f'''set -e
work=$(mktemp -d)
trap 'kill $(cat "$work/pid" 2>/dev/null) 2>/dev/null || true; rm -rf "$work"' EXIT
splash() {{ {binary} "$@" --fb /nonexistent --tty /dev/null --pid "$work/pid" --control "$work/ctl" --status "$work/status" --steps "$work/steps" --log "$work/log"; }}
daemon() {{ splash --daemon "$@"; for i in $(seq 1 20); do [ -s "$work/pid" ] && break; sleep 0.1; done; }}
alive() {{ kill -0 "$(cat "$work/pid" 2>/dev/null)" 2>/dev/null; }}
gone() {{ for i in $(seq 1 40); do alive || return 0; sleep 0.1; done; return 1; }}
'''
        return self.tools.run(head + body).stdout

    def test_milestones_are_recorded_in_order_and_ready_fades_out_and_cleans_up(self):
        out = self.script('''daemon --timeout 60
[ "$(stat -c %a "$work/steps")" = 1777 ]
splash --step system; sleep 0.5; grep -q "milestone system" "$work/log"
splash --step session; splash --step compositor; sleep 0.5
grep -q "milestone session" "$work/log"; grep -q "milestone compositor" "$work/log"
alive                                            # not ready yet: it keeps going
splash --step window; sleep 0.5; grep -q "milestone window" "$work/log"; alive
splash --step shell; sleep 0.5; alive
splash --step ready
gone                                             # fade-out (~300 ms) and exit
[ ! -e "$work/steps" ] && [ ! -e "$work/pid" ]   # the milestone files go away with it
grep -q "leaving" "$work/log"
echo MILESTONES-OK''')
        self.assertIn('MILESTONES-OK', out)

    def test_a_session_that_never_starts_falls_back_to_text(self):
        out = self.script('''daemon --timeout 60 --session-timeout 1
sleep 0.3; alive
gone
grep -q "timeout: the session never started" "$work/log"
echo SESSION-TIMEOUT-OK''')
        self.assertIn('SESSION-TIMEOUT-OK', out)

    def test_a_session_that_never_reports_ready_falls_back_to_text(self):
        out = self.script('''daemon --timeout 60 --ready-timeout 1
splash --step session; sleep 0.5; alive
gone
grep -q "timeout: not ready" "$work/log"
echo READY-TIMEOUT-OK''')
        self.assertIn('READY-TIMEOUT-OK', out)

    def test_late_milestones_keep_it_running_and_ready_always_wins(self):
        out = self.script('''daemon --timeout 60 --session-timeout 5 --ready-timeout 5
splash --step session; sleep 3; alive            # a slow step is not a failure
splash --step ready; gone
echo LATE-OK''')
        self.assertIn('LATE-OK', out)

    def test_steps_are_fire_and_forget(self):
        out = self.script('''splash --step system                          # no daemon, no directory: must not fail
splash --step shell
rc=0; splash --step bogus || rc=$?; [ "$rc" = 2 ]    # only the known milestones are accepted
mkdir "$work/user" && DEVOS_SPLASH_STEPS="$work/user" {binary} --step session && [ -e "$work/user/session" ]
echo STEPS-OK'''.replace('{binary}', self.tools.path(self.binary)))
        self.assertIn('STEPS-OK', out)


if __name__ == '__main__': unittest.main()
