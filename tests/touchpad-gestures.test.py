#!/usr/bin/env python3
"""Tests bin/dev-os-touchpad-gestures: lock persistence, touchpad detection, edge-gesture recognition and the daemon
against fake /proc, fake evdev event streams and fake wpctl / backlight / shell tools."""
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'bin' / 'dev-os-touchpad-gestures'
DRIVER = ROOT / 'tests/fixtures/touchpad-driver.dev'
D = os.environ.get('DEVLANG_BIN') or shutil.which('d') or str(Path.home() / '.local/bin/d')

PROC = '''I: Bus=0003 Vendor=0b05 Product=1a30 Version=0100
N: Name="ASUE1234:00 04F3:3294 Touchpad"
P: Phys=i2c-ASUE1234:00
H: Handlers=mouse0 event3
B: PROP=5
B: EV=b
B: KEY=e520 10000 0 0 0 0
B: ABS=260800000000003

I: Bus=0011 Vendor=0001 Product=0001 Version=ab41
N: Name="AT Translated Set 2 keyboard"
H: Handlers=sysrq kbd event0 leds
B: EV=120013
B: KEY=402000000 3803078f800d001 feffffdfffefffff fffffffffffffffe
'''
FAKE_TOOL = '#!/bin/sh\necho "$(basename "$0") $*" >> "$FAKE_LOG"\n'
FAKE_TOUCHPAD_HELPER = '''#!/usr/bin/env python3
import json, os, sys
request = json.loads(sys.stdin.readline())
open(os.environ["FAKE_LOG"], "a").write("touchpad " + json.dumps(request) + "\\n")
if os.environ.get("FAKE_TOUCHPAD_FAIL") and request["action"] == "save":
    print(json.dumps({"ok": False, "error": "The compositor could not reload touchpad settings."})); sys.exit(1)
print(json.dumps({"ok": True, "settings": {"tap": True, "drag": True, "natural": True, "typing": True, "leftHanded": False, "speed": 50}, "devices": [], "applied": True}))
'''
W, H = 1000, 600
EVENT = struct.Struct('llHHi')


def stream(*frames):
    """frames: lists of (type, code, value); every frame ends with SYN_REPORT."""
    data = b''
    for frame in frames:
        for kind, code, value in frame + [(0, 0, 0)]:
            data += EVENT.pack(0, 0, kind, code, value)
    return data


def down(x, y, slot=0, tracking=1):
    return [(3, 0x2f, slot), (3, 0x39, tracking), (3, 0x35, x), (3, 0x36, y)]


def move(x, y, slot=0):
    return [(3, 0x2f, slot), (3, 0x35, x), (3, 0x36, y)]


def up(slot=0):
    return [(3, 0x2f, slot), (3, 0x39, -1)]


class Replay:
    """Feeds frames into the recognizer of lib/touchpad-gestures.dev (through tests/fixtures/touchpad-driver.dev) and reads what it emitted."""
    def __init__(self, gate=True):
        self.ops = [] if gate else [{'op': 'gate', 'value': False}]

    def play(self, *frames):
        self.ops.append({'op': 'frames', 'frames': [list(map(list, frame)) for frame in frames]})
        return self.out

    def set_gate(self, value):
        self.ops.append({'op': 'gate', 'value': value})

    def advance(self, seconds):
        self.ops.append({'op': 'advance', 'value': seconds})

    @property
    def out(self):
        script = {'extent': [0, W, 0, H], 'ops': self.ops}
        done = subprocess.run([D, str(DRIVER), '--'], capture_output=True, text=True, env=os.environ | {'DRIVER_SCRIPT': json.dumps(script)}, timeout=60)
        assert done.returncode == 0, done.stdout + done.stderr
        return [tuple(item) for item in json.loads(done.stdout)]


def path(fraction, size):
    return int(fraction * size)


class EngineTests(unittest.TestCase):
    def test_left_edge_slide_up_is_volume_up_and_down_is_volume_down(self):
        r = Replay()
        r.play(down(30, 500), move(30, 480), *[move(30, 480 - 15 * i) for i in range(1, 21)])
        self.assertTrue(r.out and all(a == 'volume' and s > 0 for a, s in r.out), r.out)
        self.assertGreaterEqual(sum(s for _, s in r.out), 4)
        r.play(up())
        r = Replay()
        r.play(down(30, 100), *[move(30, 100 + 15 * i) for i in range(1, 25)])
        self.assertTrue(r.out and all(a == 'volume' and s < 0 for a, s in r.out), r.out)

    def test_right_edge_is_brightness_and_top_edge_is_seek(self):
        r = Replay()
        r.play(down(970, 400), *[move(970, 400 - 15 * i) for i in range(1, 18)])
        self.assertTrue(r.out and all(a == 'brightness' and s > 0 for a, s in r.out), r.out)
        r = Replay()
        r.play(down(300, 20), *[move(300 + 20 * i, 22) for i in range(1, 20)])
        self.assertTrue(r.out and all(a == 'seek' and s > 0 for a, s in r.out), r.out)
        r = Replay()
        r.play(down(700, 20), *[move(700 - 20 * i, 22) for i in range(1, 20)])
        self.assertTrue(r.out and all(a == 'seek' and s < 0 for a, s in r.out), r.out)

    def test_top_right_corner_swipe_launches_once_with_cooldown(self):
        r = Replay()
        r.play(down(960, 20), *[move(960 - 12 * i, 20 + 8 * i) for i in range(1, 16)])
        self.assertEqual(r.out, [('launch', 1)])
        r.play(up(), down(960, 20), *[move(960 - 12 * i, 20 + 8 * i) for i in range(1, 16)])
        self.assertEqual(r.out, [('launch', 1)], 'Cooldown suppresses an immediate repeat')
        r.advance(2.0)
        r.play(up(), down(960, 20), *[move(960 - 12 * i, 20 + 8 * i) for i in range(1, 16)])
        self.assertEqual(len(r.out), 2)

    def test_normal_pointer_use_does_not_trigger(self):
        for start, frames in {
            'centre': [down(500, 300), *[move(500, 300 + 10 * i) for i in range(1, 30)]],
            'edge start, sideways': [down(30, 300), *[move(30 + 20 * i, 300 + 2 * i) for i in range(1, 20)]],
            'edge start, mostly across': [down(30, 300), *[move(30 + 12 * i, 300 + 6 * i) for i in range(1, 20)]],
            'tiny wobble': [down(30, 300), move(32, 303), move(29, 298), move(31, 301)],
            'tap on the corner': [down(960, 20), up()],
        }.items():
            r = Replay()
            r.play(*frames)
            self.assertEqual(r.out, [], start)

    def test_second_finger_cancels_until_all_fingers_lift(self):
        r = Replay()
        r.play(down(30, 500), move(30, 480), down(400, 300, slot=1, tracking=2))
        r.play(*[move(30, 450 - 15 * i) for i in range(1, 15)])
        self.assertEqual(r.out, [])
        r.play(up(1), *[move(30, 200 - 3 * i) for i in range(1, 15)])
        self.assertEqual(r.out, [], 'Still cancelled while the first finger remains down')
        r.play(up(), down(30, 500), *[move(30, 500 - 15 * i) for i in range(1, 20)])
        self.assertTrue(r.out)

    def test_gate_disables_recognition(self):
        r = Replay(gate=False)
        r.play(down(30, 500), *[move(30, 500 - 15 * i) for i in range(1, 20)])
        self.assertEqual(r.out, [])
        r.set_gate(True)
        r.play(up(), down(30, 500), *[move(30, 500 - 15 * i) for i in range(1, 20)])
        self.assertTrue(r.out)
        r.set_gate(False)
        n = len(r.out)
        r.play(*[move(30, 200 - 3 * i) for i in range(1, 10)])
        self.assertEqual(len(r.out), n, 'Locking mid-gesture stops it')


class HelperCase(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='devos-tp-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.log = self.root / 'log'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name in ('wpctl', 'dev-os-backlight', 'dev-os-shell', 'systemctl', 'systemd-run', 'busctl', 'notify-send'):
            self.tool(name, FAKE_TOOL)
        self.tool('touchpad-helper', FAKE_TOUCHPAD_HELPER)
        (self.root / 'proc').write_text(PROC)
        (self.root / 'dev').mkdir()
        (self.root / 'sys/class/backlight/panel').mkdir(parents=True)
        self.env = os.environ | {
            'XDG_CONFIG_HOME': str(self.root / 'config'), 'FAKE_LOG': str(self.log), 'DEVOS_TP_PROC': str(self.root / 'proc'),
            'DEVOS_TP_DEV': str(self.root / 'dev'), 'DEVOS_TP_SYS': str(self.root / 'sys'), 'DEVOS_TP_PATH': str(self.bin),
            'DEVOS_TP_TOUCHPAD_HELPER': str(self.bin / 'touchpad-helper'), 'DEVOS_TP_SYSTEMCTL': str(self.bin / 'systemctl'),
            'DEVOS_TP_SYSTEMRUN': str(self.bin / 'systemd-run'), 'DEVOS_TP_WPCTL': str(self.bin / 'wpctl'),
            'DEVOS_TP_BACKLIGHT': str(self.bin / 'dev-os-backlight'), 'DEVOS_TP_SHELL': str(self.bin / 'dev-os-shell'),
            'DEVOS_TP_BUSCTL': str(self.bin / 'busctl'), 'DEVOS_TP_NOTIFY': str(self.bin / 'notify-send'),
        }

    def tool(self, name, text):
        file = self.bin / name
        file.write_text(text)
        file.chmod(0o755)

    def node(self, name='event3', data=b''):
        (self.root / 'dev' / name).write_bytes(data)

    def run_helper(self, *args, env=None, code=0):
        done = subprocess.run(['sh', str(HELPER), *args], capture_output=True, text=True, env=self.env | (env or {}), timeout=30)
        self.assertEqual(done.returncode, code, done.stdout + done.stderr)
        return json.loads(done.stdout.splitlines()[-1])

    def logged(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def saved(self):
        return json.loads((self.root / 'config/dev-os/touchpad-gestures.json').read_text())


class CommandTests(HelperCase):
    def test_get_reports_only_the_real_touchpad_and_defaults(self):
        self.node()
        state = self.run_helper('get')
        self.assertEqual(state['devices'], ['ASUE1234:00 04F3:3294 Touchpad'])
        self.assertTrue(state['supported'] and state['gesturesAvailable'])
        self.assertEqual((state['locked'], state['enabled'], state['launch']), (False, False, 'task-manager'))
        self.assertEqual(state['backends'], {'volume': True, 'brightness': True, 'seek': True, 'launch': True})
        self.assertIn('task-manager', [t['id'] for t in state['targets']])

    def test_no_touchpad_is_reported_and_refuses_lock_and_gestures(self):
        (self.root / 'proc').write_text(PROC.split('\n\n')[1])
        state = self.run_helper('get')
        self.assertFalse(state['supported'])
        self.assertIn('No touchpad', state['reason'])
        self.assertIn('error', self.run_helper('lock', 'on', code=1))
        self.assertIn('error', self.run_helper('gestures', 'on', code=1))
        self.assertFalse((self.root / 'config/dev-os/touchpad-gestures.json').exists())
        self.assertEqual(self.logged(), [])

    def test_unreadable_node_disables_gestures_but_not_the_lock(self):
        state = self.run_helper('get')   # no node file was created at all
        self.assertTrue(state['supported'] and not state['gesturesAvailable'])
        self.assertIn('cannot be read', state['reason'])
        self.assertTrue(self.run_helper('lock', 'on')['locked'])

    def test_lock_persists_and_reapplies_the_compositor_config(self):
        self.node()
        state = self.run_helper('lock', 'on')
        self.assertTrue(state['locked'])
        self.assertTrue(self.saved()['locked'])
        calls = [line for line in self.logged() if line.startswith('touchpad ')]
        self.assertEqual([json.loads(c[9:])['action'] for c in calls], ['get', 'save'])
        self.assertEqual(json.loads(calls[1][9:])['settings']['speed'], 50, 'The saved touchpad settings are kept')
        self.assertFalse(self.run_helper('lock', 'toggle')['locked'])
        self.assertTrue(self.run_helper('lock', 'toggle')['locked'])
        self.assertFalse(self.run_helper('lock', 'off')['locked'])
        self.assertTrue(any('notify-send' in line and 'Touchpad' in line for line in self.logged()))

    def test_lock_failure_rolls_the_saved_state_back(self):
        self.node()
        failed = self.run_helper('lock', 'on', env={'FAKE_TOUCHPAD_FAIL': '1'}, code=1)
        self.assertFalse(failed['ok'])
        self.assertIn('reload', failed['error'])
        self.assertFalse(self.saved()['locked'])

    def test_gestures_and_launch_target_are_validated_and_saved(self):
        self.node()
        state = self.run_helper('gestures', 'on')
        self.assertTrue(state['enabled'])
        self.assertTrue(any(line.startswith('systemctl --user start --no-block devos-touchpad-gestures.service') for line in self.logged()))
        self.assertEqual(self.run_helper('launch', 'launcher')['launch'], 'launcher')
        self.assertEqual(self.saved(), {'locked': False, 'enabled': True, 'launch': 'launcher'})
        for bad in (['launch', 'rm -rf /'], ['launch', ''], ['gestures', 'maybe'], ['lock', 'sideways'], ['nope']):
            self.assertFalse(self.run_helper(*bad, code=1)['ok'], bad)
        self.assertEqual(self.saved()['launch'], 'launcher')
        self.assertFalse(self.run_helper('gestures', 'off')['enabled'])

    def test_corrupt_state_falls_back_to_defaults(self):
        self.node()
        (self.root / 'config/dev-os').mkdir(parents=True)
        (self.root / 'config/dev-os/touchpad-gestures.json').write_text('{"locked": "yes", "enabled": 1, "launch": "../../bin/sh"}')
        state = self.run_helper('get')
        self.assertEqual((state['locked'], state['enabled'], state['launch']), (False, False, 'task-manager'))

    def test_apply_starts_the_service_only_when_enabled(self):
        self.node()
        self.run_helper('apply')
        self.assertEqual(self.logged(), [])
        self.run_helper('gestures', 'on')
        self.log.unlink()
        self.run_helper('apply')
        self.assertEqual(len([l for l in self.logged() if l.startswith('systemctl')]), 1)

    def test_live_session_without_the_unit_falls_back_to_a_transient_unit(self):
        self.node()
        self.tool('systemctl', '#!/bin/sh\necho "systemctl $*" >> "$FAKE_LOG"\nexit 5\n')
        self.run_helper('gestures', 'on')
        self.assertTrue(any(l.startswith('systemd-run --user --unit devos-touchpad-gestures-session.service') and l.endswith('serve') for l in self.logged()), self.logged())


class DaemonTests(HelperCase):
    def serve(self, events, **state):
        self.node(data=events)
        saved = {'locked': False, 'enabled': True, 'launch': 'task-manager'} | state
        (self.root / 'config/dev-os').mkdir(parents=True, exist_ok=True)
        (self.root / 'config/dev-os/touchpad-gestures.json').write_text(json.dumps(saved))
        done = subprocess.run(['sh', str(HELPER), 'serve'], capture_output=True, text=True, timeout=30,
                              env=self.env | {'DEVOS_TP_ONESHOT': '1', 'DEVOS_TP_RANGE': f'0,{W},0,{H}'})
        self.assertEqual(done.returncode, 0, done.stderr)
        import time
        time.sleep(0.4)   # the actions are spawned without waiting
        return self.logged()

    def test_reads_events_and_runs_the_matching_helpers(self):
        volume = stream(down(30, 500), *[move(30, 500 - 15 * i) for i in range(1, 21)], up())
        calls = self.serve(volume)
        self.assertTrue(calls and all(c.startswith('wpctl set-volume --limit 1.0 @DEFAULT_AUDIO_SINK@ 5%+') for c in calls), calls)
        self.log.unlink()
        brightness = stream(down(970, 100), *[move(970, 100 + 15 * i) for i in range(1, 21)], up())
        calls = self.serve(brightness)
        self.assertTrue(calls and all(c == 'dev-os-backlight -- down' for c in calls), calls)
        self.log.unlink()
        calls = self.serve(stream(down(960, 20), *[move(960 - 12 * i, 20 + 8 * i) for i in range(1, 16)], up()), launch='files')
        self.assertEqual(calls, ['dev-os-shell files'])
        self.log.unlink()
        calls = self.serve(stream(down(960, 20), *[move(960 - 12 * i, 20 + 8 * i) for i in range(1, 16)], up()), launch='none')
        self.assertEqual(calls, [])

    def test_top_edge_seeks_the_playing_mpris_player(self):
        self.tool('busctl', '#!/bin/sh\necho "busctl $*" >> "$FAKE_LOG"\n'
                  'case "$*" in *" list "*) echo "org.mpris.MediaPlayer2.mpv 100 mpv user :1.5 session-1 - -";; *get-property*) echo "s \\"Playing\\"";; esac\n')
        calls = self.serve(stream(down(300, 20), *[move(300 + 20 * i, 22) for i in range(1, 16)], up()))
        seeks = [c for c in calls if ' call org.mpris.MediaPlayer2.mpv /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player Seek x ' in c]
        self.assertTrue(seeks, calls)
        self.assertTrue(all(int(c.rsplit(' ', 1)[1]) > 0 and int(c.rsplit(' ', 1)[1]) % 5000000 == 0 for c in seeks))

    def test_disabled_or_locked_does_nothing(self):
        events = stream(down(30, 500), *[move(30, 500 - 15 * i) for i in range(1, 21)], up())
        self.assertEqual(self.serve(events, enabled=False), [])
        self.assertEqual(self.serve(events, locked=True), [])


class PackagingTests(unittest.TestCase):
    def test_session_wiring(self):
        session = ROOT / 'distro/oe/meta-devos/recipes-devos/session'
        recipe = (session / 'devos-session.bb').read_text()
        for name in ('devos-touchpad-gestures.service', '72-devos-touchpad.rules'):
            self.assertIn('file://' + name, recipe)
            self.assertTrue((session / 'files' / name).is_file())
        self.assertIn('default.target.wants/devos-touchpad-gestures.service', recipe)
        self.assertIn('devos-touchpad-gestures.service', (session / 'files/devos-desktop').read_text())
        self.assertIn('dev-os-touchpad-gestures apply', (ROOT / 'distro/usb/root-session').read_text())
        unit = (session / 'files/devos-touchpad-gestures.service').read_text()
        self.assertIn('ExecStart=/usr/bin/dev-os-touchpad-gestures serve', unit)
        self.assertIn('TAG+="uaccess"', (session / 'files/72-devos-touchpad.rules').read_text())

    def test_touchpad_keys_are_bound_in_the_compositor_config(self):
        rc = (ROOT / 'config/labwc/rc.xml').read_text()
        for key, action in (('XF86TouchpadToggle', 'toggle'), ('XF86TouchpadOff', 'on'), ('XF86TouchpadOn', 'off')):
            self.assertIn(f'<keybind key="{key}"><action name="Execute" command="dev-os-touchpad-gestures lock {action}" /></keybind>', rc)

    def test_helper_is_a_devlang_launcher(self):
        self.assertTrue(HELPER.read_text().startswith('#!/bin/sh'))
        self.assertIn('touchpad-gestures-cli.dev', HELPER.read_text())
        self.assertTrue((ROOT / 'lib/touchpad-gestures.dev').is_file())


if __name__ == '__main__':
    unittest.main()
