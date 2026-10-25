import importlib.machinery
import importlib.util
import json
import os
import socket
import struct
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / 'native/devos-keyboard'
TOOL = ROOT / 'bin/dev-os-keyboard'


def wait_for(condition, seconds=4):
    end = time.time() + seconds
    while time.time() < end:
        if condition():
            return True
        time.sleep(0.02)
    return False


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sys = self.root / 'sys'; self.sys.mkdir()
        self.runtime = self.root / 'run'; self.runtime.mkdir()
        self.prefs = self.root / 'config/keyboard.json'
        self.state = self.root / 'var/keyboard.conf'
        self.env = dict(os.environ, DEVOS_KBD_SYS=str(self.root), DEVOS_KBD_PREFS=str(self.prefs), DEVOS_KBD_STATE=str(self.state),
                        DEVOS_KBD_CORE=str(CORE), DEVOS_KBD_ALLOW_USER='1', DEVOS_KBD_DIRECT='1', XDG_RUNTIME_DIR=str(self.runtime))
        self.env.pop('WAYLAND_DISPLAY', None)

    def put(self, relative, value):
        path = self.sys / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(str(value) + '\n'); return path

    def led(self, level=1, maximum=3, name='asus::kbd_backlight'):
        self.put(f'class/leds/{name}/max_brightness', maximum); return self.put(f'class/leds/{name}/brightness', level)

    def fn_lock(self, value=1): return self.put('devices/platform/asus-nb-wmi/fn_lock', value)

    def supply(self, name, kind, **attributes):
        for key, value in ({'type': kind} | attributes).items(): self.put(f'class/power_supply/{name}/{key}', value)

    def run_tool(self, *args, check=True):
        done = subprocess.run(['python3', str(TOOL), *args], env=self.env, capture_output=True, text=True, timeout=30)
        if check: self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        return json.loads(done.stdout), done.returncode

    def run_core(self, *args, user=True):
        env = dict(self.env)
        if not user: env.pop('DEVOS_KBD_ALLOW_USER')
        done = subprocess.run(['sh', str(CORE), *args], env=env, capture_output=True, text=True, timeout=30)
        return json.loads(done.stdout), done.returncode


class FnKeyTests(Fixture):
    def test_missing_node_is_unsupported_and_never_created(self):
        value, code = self.run_core('get')
        self.assertEqual((code, value['ok'], value['supported'], value['mode']), (0, True, False, ''))
        self.assertIn('no Fn lock', value['reason'])
        value, code = self.run_core('set', 'fn', 'normal')
        self.assertEqual(code, 1); self.assertFalse(value['ok'])
        self.assertFalse((self.sys / 'devices/platform/asus-nb-wmi').exists())

    def test_set_validates_writes_and_persists(self):
        node = self.fn_lock(1)
        self.assertEqual(self.run_core('get')[0]['mode'], 'locked')
        value, code = self.run_core('set', 'fn', 'normal')
        self.assertEqual((code, value['mode'], value['saved']), (0, 'normal', 'normal'))
        self.assertEqual(node.read_text().strip(), '0')
        self.assertEqual(self.state.read_text(), 'fn=normal\n')
        for bad in ('Normal', 'locked; reboot', '', '1'):
            self.assertEqual(self.run_core('set', 'fn', bad)[1], 1)
        self.assertEqual(self.run_core('set', 'brightness', 'locked')[1], 1)
        self.assertEqual(node.read_text().strip(), '0')

    def test_requires_root_without_the_test_hook(self):
        self.fn_lock(1)
        value, code = self.run_core('set', 'fn', 'normal', user=False)
        if os.geteuid() != 0:
            self.assertEqual(code, 1); self.assertIn('administrator', value['error'])

    def test_apply_restores_the_saved_mode_and_leaves_firmware_alone_without_state(self):
        node = self.fn_lock(1)
        self.assertEqual(self.run_core('apply')[0]['mode'], 'locked')
        self.state.parent.mkdir(parents=True); self.state.write_text('fn=normal\n')
        self.assertEqual(self.run_core('apply')[0]['mode'], 'normal'); self.assertEqual(node.read_text().strip(), '0')
        self.state.write_text('fn=garbage\n'); node.write_text('1\n')
        self.assertEqual(self.run_core('apply')[0]['mode'], 'locked')

    def test_unreadable_value_is_unsupported(self):
        self.fn_lock('banana')
        self.assertFalse(self.run_core('get')[0]['supported'])


class FrontEndTests(Fixture):
    def test_nothing_is_available_on_this_board_without_devices(self):
        value, _ = self.run_tool('get')
        self.assertTrue(value['ok'])
        self.assertFalse(value['backlight']['supported']); self.assertFalse(value['sensor']['supported'])
        self.assertFalse(value['idle']['supported']); self.assertFalse(value['fn']['supported'])
        self.assertEqual(value['settings'], {'autoBrighten': False, 'autoDim': False, 'sleep': 'nothing', 'sleepBoth': 60, 'sleepBattery': 60})
        self.assertEqual(value['timeouts'], [10, 30, 60, 120, 300, 600])

    def test_detects_led_sensor_and_fn_lock(self):
        self.led(2); self.fn_lock(0)
        self.put('bus/iio/devices/iio:device0/in_illuminance_raw', 40); self.put('bus/iio/devices/iio:device0/in_illuminance_scale', 0.5)
        value, _ = self.run_tool('get')
        self.assertEqual((value['backlight']['name'], value['backlight']['max'], value['backlight']['level']), ('asus::kbd_backlight', 3, 2))
        self.assertTrue(value['sensor']['supported']); self.assertEqual(value['sensor']['lux'], 20.0)
        self.assertEqual((value['fn']['supported'], value['fn']['mode']), (True, 'normal'))

    def test_sensor_needs_a_backlight_to_be_useful(self):
        self.put('bus/iio/devices/iio:device0/in_illuminance_input', 12)
        value, _ = self.run_tool('get')
        self.assertFalse(value['sensor']['supported'])

    def test_preferences_are_saved_validated_and_survive_corruption(self):
        self.run_tool('set', 'auto-brighten', 'on'); self.run_tool('set', 'auto-dim', 'on')
        self.run_tool('set', 'sleep', 'battery'); self.run_tool('set', 'sleep-both', '300')
        value, _ = self.run_tool('set', 'sleep-battery', '10')
        self.assertEqual(value['settings'], {'autoBrighten': True, 'autoDim': True, 'sleep': 'battery', 'sleepBoth': 300, 'sleepBattery': 10})
        self.assertEqual(json.loads(self.prefs.read_text()), value['settings'])
        for args in (('sleep-both', '45'), ('sleep-both', 'abc'), ('sleep', 'always'), ('auto-dim', 'maybe'), ('colour', 'red'), ('sleep-battery', '-5')):
            self.assertEqual(self.run_tool('set', *args, check=False)[1], 1, args)
        self.assertEqual(json.loads(self.prefs.read_text()), value['settings'])
        self.prefs.write_text('{"sleep": "bogus", "sleepBoth": 7, "autoDim": "yes", "autoBrighten": true}')
        self.assertEqual(self.run_tool('get')[0]['settings'], {'autoBrighten': True, 'autoDim': False, 'sleep': 'nothing', 'sleepBoth': 60, 'sleepBattery': 60})
        self.prefs.write_text('not json')
        self.assertEqual(self.run_tool('get')[0]['settings']['sleep'], 'nothing')

    def test_fn_goes_through_the_helper(self):
        node = self.fn_lock(1)
        value, _ = self.run_tool('set', 'fn', 'normal')
        self.assertEqual((value['fn']['mode'], node.read_text().strip()), ('normal', '0'))
        self.assertEqual(self.run_tool('set', 'fn', 'weird', check=False)[1], 1)

    def test_fn_failure_is_reported(self):
        value, code = self.run_tool('set', 'fn', 'locked', check=False)
        self.assertEqual(code, 1); self.assertFalse(value['ok'])

    def test_mains_state(self):
        self.supply('BAT1', 'Battery'); self.supply('ADP1', 'Mains', online=1)
        self.assertTrue(self.run_tool('get')[0]['mains'])
        self.supply('ADP1', 'Mains', online=0)
        self.assertFalse(self.run_tool('get')[0]['mains'])


def load_daemon(env):
    for key in ('DEVOS_KBD_SYS', 'DEVOS_KBD_PREFS', 'XDG_RUNTIME_DIR', 'WAYLAND_DISPLAY'):
        if key in env: os.environ[key] = env[key]
        else: os.environ.pop(key, None)
    os.environ.update({'DEVOS_KBD_DIRECT': '1', 'DEVOS_KBD_TICK': '0.05', 'DEVOS_KBD_DEBOUNCE': '3', 'DEVOS_KBD_DARK': '15', 'DEVOS_KBD_BRIGHT': '60'})
    loader = importlib.machinery.SourceFileLoader('dev_os_keyboard', str(TOOL))
    spec = importlib.util.spec_from_loader('dev_os_keyboard', loader); module = importlib.util.module_from_spec(spec); loader.exec_module(module)
    return module


class AmbientLightTests(Fixture):
    def setUp(self):
        super().setUp()
        self.level_file = self.led(0)
        self.lux_file = self.put('bus/iio/devices/iio:device0/in_illuminance_input', 300)
        self.kbd = load_daemon(self.env)
        self.daemon = self.kbd.Backlight(self.kbd.find_led())
        self.saved_prefs(autoBrighten=True, autoDim=True)

    def saved_prefs(self, **values):
        self.kbd.save_prefs(self.kbd.validate({**self.kbd.DEFAULTS, **values})); self.daemon.reload()

    def feed(self, lux, times=3):
        self.lux_file.write_text(f'{lux}\n')
        for _ in range(times): self.daemon.sensor_tick()

    def level(self): return int(self.level_file.read_text())

    def test_first_reading_only_sets_the_baseline(self):
        self.feed(2)
        self.assertEqual(self.level(), 0); self.assertTrue(self.daemon.dark)

    def test_dark_turns_on_with_the_last_used_level_and_bright_turns_off(self):
        self.feed(300); self.assertFalse(self.daemon.dark)
        self.daemon.last_on = 2
        self.feed(3); self.assertEqual(self.level(), 2)
        self.feed(300); self.assertEqual(self.level(), 0)

    def test_debounce_ignores_a_short_shadow(self):
        self.feed(300)
        self.lux_file.write_text('1\n'); self.daemon.sensor_tick(); self.daemon.sensor_tick()
        self.lux_file.write_text('300\n')
        for _ in range(6): self.daemon.sensor_tick()
        self.assertEqual(self.level(), 0); self.assertFalse(self.daemon.dark)

    def test_hysteresis_band_changes_nothing(self):
        self.feed(300); self.feed(2); self.assertEqual(self.level(), self.kbd.find_led()['max'])
        self.level_file.write_text('1\n')
        self.feed(40, 10)  # between 15 and 60 lux: still dark, backlight untouched
        self.assertEqual(self.level(), 1); self.assertTrue(self.daemon.dark)

    def test_switches_work_independently(self):
        self.saved_prefs(autoBrighten=False, autoDim=True); self.feed(300); self.feed(2)
        self.assertEqual(self.level(), 0)
        self.level_file.write_text('2\n'); self.feed(300); self.assertEqual(self.level(), 0)
        self.saved_prefs(autoBrighten=True, autoDim=False); self.level_file.write_text('2\n'); self.feed(2); self.feed(300)
        self.assertEqual(self.level(), 2)

    def test_manual_off_stays_off_until_the_light_changes(self):
        self.feed(300); self.feed(2); self.level_file.write_text('0\n')
        for _ in range(8): self.daemon.sensor_tick()
        self.assertEqual(self.level(), 0)

    def test_raw_scale_offset_conversion(self):
        self.lux_file.unlink(); self.put('bus/iio/devices/iio:device0/in_illuminance_raw', 100)
        self.put('bus/iio/devices/iio:device0/in_illuminance_scale', 0.25); self.put('bus/iio/devices/iio:device0/in_illuminance_offset', 20)
        self.assertEqual(self.kbd.read_lux(), 30.0)


class FakeCompositor(threading.Thread):
    """Speaks just enough Wayland: wl_registry globals, wl_seat, ext_idle_notifier_v1 and idle notifications."""

    def __init__(self, path, advertise_idle=True):
        super().__init__(daemon=True)
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); self.server.bind(str(path)); self.server.listen(4)
        self.advertise_idle = advertise_idle; self.requests = []; self.conn = None; self.stop = False
        self.ids = {}; self.start()

    @staticmethod
    def string(text):
        data = text.encode() + b'\0'; return struct.pack('<I', len(data)) + data + b'\0' * (-len(data) % 4)

    def event(self, obj, opcode, payload=b''):
        self.conn.sendall(struct.pack('<II', obj, ((8 + len(payload)) << 16) | opcode) + payload)

    def run(self):
        self.server.settimeout(0.1)
        while not self.stop:
            try: conn, _ = self.server.accept()
            except (socket.timeout, OSError): continue
            self.conn = conn; self.serve(conn)

    def serve(self, conn):
        buffer = b''; conn.settimeout(0.1)
        while not self.stop:
            try: chunk = conn.recv(4096)
            except socket.timeout: continue
            except OSError: return
            if not chunk: return
            buffer += chunk
            while len(buffer) >= 8:
                obj, header = struct.unpack_from('<II', buffer); size, opcode = header >> 16, header & 0xffff
                if len(buffer) < size: break
                payload, buffer = buffer[8:size], buffer[size:]
                self.handle(obj, opcode, payload)

    def handle(self, obj, opcode, payload):
        if obj == 1 and opcode == 1:
            self.registry = struct.unpack('<I', payload)[0]
            self.event(self.registry, 0, struct.pack('<I', 1) + self.string('wl_seat') + struct.pack('<I', 7))
            if self.advertise_idle: self.event(self.registry, 0, struct.pack('<I', 2) + self.string('ext_idle_notifier_v1') + struct.pack('<I', 2))
        elif obj == 1 and opcode == 0:
            self.event(struct.unpack('<I', payload)[0], 0, struct.pack('<I', 0))
        elif obj == getattr(self, 'registry', None) and opcode == 0:
            name = struct.unpack_from('<I', payload)[0]; length = struct.unpack_from('<I', payload, 4)[0]
            interface = payload[8:8 + length - 1].decode(); version, ident = struct.unpack_from('<II', payload, 8 + ((length + 3) & ~3))
            self.ids[ident] = interface; self.requests.append(('bind', interface, version))
        elif self.ids.get(obj) == 'ext_idle_notifier_v1' and opcode in (1, 2):
            ident, timeout, seat = struct.unpack('<III', payload); self.ids[ident] = 'notification'
            self.requests.append(('notify', opcode, timeout, self.ids.get(seat))); self.notification = ident
        elif self.ids.get(obj) == 'notification' and opcode == 0:
            self.requests.append(('destroy',))

    def notifications(self): return [r for r in self.requests if r[0] == 'notify']
    def idled(self): self.event(self.notification, 0)
    def resumed(self): self.event(self.notification, 1)
    def close(self):
        self.stop = True; self.join(2); self.server.close()


class IdleSleepTests(Fixture):
    def setUp(self):
        super().setUp()
        self.level_file = self.led(2)
        self.socket_path = self.runtime / 'wayland-test'
        self.env['WAYLAND_DISPLAY'] = str(self.socket_path)
        self.compositor = FakeCompositor(self.socket_path); self.addCleanup(self.compositor.close)
        self.kbd = load_daemon(self.env)
        self.daemon = self.kbd.Backlight(self.kbd.find_led())
        self.thread = threading.Thread(target=self.daemon.serve, daemon=True)
        self.addCleanup(self.stop_daemon)

    def stop_daemon(self):
        self.daemon.stopped = True
        if self.thread.is_alive(): self.thread.join(3)

    def level(self):
        # Regular-file sysfs fixtures can be empty between truncate and write.
        # None keeps wait_for polling without mistaking an unfinished write for off.
        text = self.level_file.read_text().strip()
        return int(text) if text else None

    def test_level_waits_for_a_complete_brightness_write(self):
        self.level_file.write_text('')
        self.assertIsNone(self.level())
        self.assertFalse(wait_for(lambda: self.level() == 0, seconds=0.05))
        self.level_file.write_text('0\n')
        self.assertTrue(wait_for(lambda: self.level() == 0))
        self.level_file.write_text('2\n')
        self.assertTrue(wait_for(lambda: self.level() == 2))

    def prefs_set(self, **values):
        self.kbd.save_prefs(self.kbd.validate({**self.kbd.DEFAULTS, **values}))

    def test_probe_reports_the_protocol(self):
        self.assertEqual(self.kbd.probe_idle(), (True, ''))
        self.compositor.close(); self.assertFalse(self.kbd.probe_idle()[0])

    def test_probe_without_the_idle_protocol(self):
        self.compositor.close()
        self.compositor = FakeCompositor(self.socket_path.with_name('wayland-bare'), advertise_idle=False); self.addCleanup(self.compositor.close)
        os.environ['WAYLAND_DISPLAY'] = str(self.socket_path.with_name('wayland-bare'))
        ok, reason = self.kbd.probe_idle()
        self.assertFalse(ok); self.assertIn('ext-idle-notify', reason)

    def test_backlight_sleeps_when_idle_and_returns_on_input(self):
        self.prefs_set(sleep='both', sleepBoth=30); self.thread.start()
        self.assertTrue(wait_for(lambda: self.compositor.notifications()))
        kind = self.compositor.notifications()[0]
        self.assertEqual((kind[1], kind[2], kind[3]), (2, 30000, 'wl_seat'))  # v2 input idle notification, 30 s
        self.compositor.idled(); self.assertTrue(wait_for(lambda: self.level() == 0))
        self.compositor.resumed(); self.assertTrue(wait_for(lambda: self.level() == 2))

    def test_already_off_backlight_stays_off_after_resume(self):
        self.level_file.write_text('0\n'); self.prefs_set(sleep='both', sleepBoth=10); self.thread.start()
        self.assertTrue(wait_for(lambda: self.compositor.notifications()))
        self.compositor.idled(); time.sleep(0.2); self.compositor.resumed(); time.sleep(0.3)
        self.assertEqual(self.level(), 0)

    def test_do_nothing_creates_no_notification(self):
        self.thread.start(); time.sleep(0.4)
        self.assertEqual(self.compositor.notifications(), [])

    def test_battery_only_follows_the_mains_state(self):
        self.supply('BAT1', 'Battery'); self.supply('ADP1', 'Mains', online=1)
        self.prefs_set(sleep='battery', sleepBattery=120); self.thread.start(); time.sleep(0.5)
        self.assertEqual(self.compositor.notifications(), [])  # on AC: nothing to wait for
        self.supply('ADP1', 'Mains', online=0)
        self.assertTrue(wait_for(lambda: self.compositor.notifications()))
        self.assertEqual(self.compositor.notifications()[0][2], 120000)
        self.compositor.idled(); self.assertTrue(wait_for(lambda: self.level() == 0))
        self.supply('ADP1', 'Mains', online=1)  # plugging in wakes the backlight again
        self.assertTrue(wait_for(lambda: self.level() == 2))

    def test_changing_the_time_replaces_the_notification(self):
        self.prefs_set(sleep='both', sleepBoth=10); self.thread.start()
        self.assertTrue(wait_for(lambda: self.compositor.notifications()))
        time.sleep(0.05); self.prefs_set(sleep='both', sleepBoth=300)
        os.utime(self.prefs, (time.time() + 5, time.time() + 5))
        self.assertTrue(wait_for(lambda: len(self.compositor.notifications()) == 2))
        self.assertEqual([r[2] for r in self.compositor.notifications()], [10000, 300000])
        self.assertIn(('destroy',), self.compositor.requests)

    def test_turning_sleep_off_while_idle_restores_the_backlight(self):
        self.prefs_set(sleep='both', sleepBoth=10); self.thread.start()
        self.assertTrue(wait_for(lambda: self.compositor.notifications()))
        self.compositor.idled(); self.assertTrue(wait_for(lambda: self.level() == 0))
        self.prefs_set(sleep='nothing'); os.utime(self.prefs, (time.time() + 5, time.time() + 5))
        self.assertTrue(wait_for(lambda: self.level() == 2))

    def supply(self, name, kind, **attributes):
        for key, value in ({'type': kind} | attributes).items(): self.put(f'class/power_supply/{name}/{key}', value)


if __name__ == '__main__':
    unittest.main()
