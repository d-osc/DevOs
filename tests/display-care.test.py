import importlib.machinery
import importlib.util
import json
import os
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'bin/dev-os-display-care'
DRIVER = ROOT / 'tests/fixtures/display-care-driver.dev'
D = os.environ.get('DEVLANG_BIN') or str(Path.home() / '.local/bin/d')
DEFAULTS = {'splendid': 'normal', 'temperature': 0, 'eyeCare': 3, 'gamut': 'native', 'dimming': 100, 'pixelRefresh': True, 'autoHidePanel': False,
            'panelTransparency': True, 'targetMode': False, 'edgeBrightness': 0}

SIZE = 256


def ramps(*cases):
    """(identity, [red, green, blue]) per settings override, computed by lib/display-care.dev."""
    done = subprocess.run([D, str(DRIVER), '--'], capture_output=True, text=True, env=os.environ | {'DRIVER_SCRIPT': json.dumps(list(cases))}, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr
    return [(item['identity'], [item['ramp'][:SIZE], item['ramp'][SIZE:2 * SIZE], item['ramp'][2 * SIZE:]]) for item in json.loads(done.stdout)]


class FakeCompositor(threading.Thread):
    """A Wayland server with an output, wlr-gamma-control and ext-idle-notify; records every ramp it is given."""

    def __init__(self, directory, gamma=True, idle=True, take_gamma=True):
        super().__init__(daemon=True)
        self.path = os.path.join(directory, 'wayland-test')
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); self.server.bind(self.path); self.server.listen(4)
        self.globals = [(1, 'wl_output', 4)] + ([(2, 'zwlr_gamma_control_manager_v1', 1)] if gamma else []) + [(3, 'wl_seat', 7)] + ([(4, 'ext_idle_notifier_v1', 1)] if idle else [])
        self.take_gamma = take_gamma
        self.ramps = []; self.released = 0; self.timeouts = []; self.objects = {}; self.clients = []; self.stop = False
        self.idle_object = None

    def reply(self, client, obj, opcode, payload=b''):
        client.sendall(struct.pack('<II', obj, ((8 + len(payload)) << 16) | opcode) + payload)

    def idled(self, active):
        if self.idle_object:
            self.reply(self.clients[0], self.idle_object, 0 if active else 1)

    def run(self):
        self.server.settimeout(0.2)
        while not self.stop:
            try:
                client, _ = self.server.accept()
            except (socket.timeout, OSError):
                continue
            self.clients.append(client); threading.Thread(target=self.serve, args=(client,), daemon=True).start()

    def serve(self, client):
        buffer = b''; client.settimeout(0.2)
        while not self.stop:
            try:
                data, fds, _, _ = socket.recv_fds(client, 65536, 4)
            except socket.timeout:
                continue
            except OSError:
                return
            if not data:
                return
            buffer += data
            while len(buffer) >= 8:
                obj, word = struct.unpack_from('<II', buffer); size, opcode = word >> 16, word & 0xffff
                if len(buffer) < size:
                    break
                payload, buffer = buffer[8:size], buffer[size:]
                self.handle(client, obj, opcode, payload, fds); fds = []

    def handle(self, client, obj, opcode, payload, fds):
        if obj == 1 and opcode == 1:  # get_registry
            registry = struct.unpack('<I', payload)[0]; self.objects[registry] = 'registry'
            for name, interface, version in self.globals:
                text = interface.encode() + b'\0'
                self.reply(client, registry, 0, struct.pack('<II', name, len(text)) + text + b'\0' * (-len(text) % 4) + struct.pack('<I', version))
        elif obj == 1 and opcode == 0:  # sync
            self.reply(client, struct.unpack('<I', payload)[0], 0, struct.pack('<I', 0))
        elif self.objects.get(obj) == 'registry' and opcode == 0:  # bind
            name, length = struct.unpack_from('<II', payload); offset = 8 + length + (-length % 4)
            _version, number = struct.unpack_from('<II', payload, offset)
            self.objects[number] = payload[8:8 + length - 1].decode()
        elif self.objects.get(obj) == 'zwlr_gamma_control_manager_v1' and opcode == 0:
            control, _output = struct.unpack('<II', payload); self.objects[control] = 'gamma'
            self.reply(client, control, 0, struct.pack('<I', SIZE)) if self.take_gamma else self.reply(client, control, 1)
        elif self.objects.get(obj) == 'gamma':
            if opcode == 0:
                data = os.pread(fds[0], SIZE * 6, 0); os.close(fds[0]); self.ramps.append(struct.unpack('<%dH' % (SIZE * 3), data))
            elif opcode == 1:
                self.released += 1
        elif self.objects.get(obj) == 'ext_idle_notifier_v1' and opcode == 1:
            number, timeout, _seat = struct.unpack('<III', payload); self.objects[number] = 'notification'; self.idle_object = number; self.timeouts.append(timeout)
        elif self.objects.get(obj) == 'notification' and opcode == 0:
            self.idle_object = None


class DisplayCareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.dir = self.temp.name
        self.config = os.path.join(self.dir, 'config'); self.runtime = os.path.join(self.dir, 'run'); os.makedirs(self.runtime)
        self.log = os.path.join(self.dir, 'calls.log')
        stub = os.path.join(self.dir, 'stub'); Path(stub).write_text(f'#!/bin/sh\necho "$*" >> {self.log}\nexit 0\n'); os.chmod(stub, 0o755)
        self.stub = stub

    def env(self, **extra):
        return os.environ | {'XDG_CONFIG_HOME': self.config, 'XDG_RUNTIME_DIR': self.runtime, 'WAYLAND_DISPLAY': 'wayland-missing', 'DEVOS_DISPLAY_SPAWN': self.stub,
                             'DEVOS_DISPLAY_BACKLIGHT': self.stub, 'DEVOS_DISPLAY_SYS': os.path.join(self.dir, 'sys')} | extra

    def run_helper(self, *args, **extra):
        done = subprocess.run(['sh', str(HELPER), *args], capture_output=True, text=True, env=self.env(**extra), timeout=30)
        return done.returncode, (json.loads(done.stdout) if done.stdout.strip() else {}), done.stderr

    def compositor(self, **options):
        server = FakeCompositor(self.runtime, **options); server.start(); self.addCleanup(lambda: (setattr(server, 'stop', True), server.server.close()))
        return server

    def test_defaults_and_reasons_without_a_compositor(self):
        code, out, _ = self.run_helper('get')
        self.assertEqual(code, 0)
        self.assertEqual(out['settings'], DEFAULTS)
        self.assertFalse(out['gamma']['available']); self.assertIn('No Wayland compositor', out['gamma']['reason'])
        self.assertFalse(out['ereading']['available']); self.assertIn('black and white', out['ereading']['reason'])
        self.assertFalse(out['gamut']['available']); self.assertEqual(out['gamut']['options'], ['native'])
        self.assertTrue(out['settings']['pixelRefresh']); self.assertTrue(out['settings']['panelTransparency']); self.assertFalse(out['settings']['autoHidePanel'])

    def test_set_validates_persists_and_starts_the_service(self):
        for key, value in [('dimming', '40'), ('splendid', 'eyecare'), ('eyeCare', '5'), ('temperature', '-20'), ('edgeBrightness', '3'), ('targetMode', 'on'), ('pixelRefresh', 'off'), ('autoHidePanel', 'true'), ('panelTransparency', 'off')]:
            code, out, _ = self.run_helper('set', key, value); self.assertEqual(code, 0, (key, out))
        saved = json.loads(Path(self.config, 'devos/display-care.json').read_text())
        self.assertEqual((saved['dimming'], saved['splendid'], saved['eyeCare'], saved['temperature'], saved['edgeBrightness']), (40, 'eyecare', 5, -20, 3))
        self.assertEqual((saved['targetMode'], saved['pixelRefresh'], saved['autoHidePanel'], saved['panelTransparency']), (True, False, True, False))
        self.assertTrue(self.wait(lambda: Path(self.log).exists() and 'serve' in Path(self.log).read_text()), 'set starts serve')
        for key, value in [('dimming', '101'), ('dimming', '-1'), ('dimming', 'abc'), ('temperature', '51'), ('eyeCare', '0'), ('edgeBrightness', '5'), ('splendid', 'ereading'), ('splendid', 'cinema'), ('gamut', 'srgb'), ('targetMode', 'maybe'), ('nonsense', '1')]:
            code, out, _ = self.run_helper('set', key, value); self.assertEqual(code, 1, (key, value)); self.assertFalse(out['ok'])
        self.assertEqual(json.loads(Path(self.config, 'devos/display-care.json').read_text()), saved)

    def test_damaged_state_falls_back_per_value(self):
        Path(self.config, 'devos').mkdir(parents=True); Path(self.config, 'devos/display-care.json').write_text(json.dumps({'dimming': 12, 'splendid': 'ereading', 'temperature': 900, 'gamut': 'dci-p3', 'targetMode': True, 'eyeCare': 'x'}))
        _, out, _ = self.run_helper('get')
        self.assertEqual((out['settings']['dimming'], out['settings']['splendid'], out['settings']['temperature'], out['settings']['gamut'], out['settings']['targetMode'], out['settings']['eyeCare']), (12, 'normal', 0, 'native', True, 3))
        Path(self.config, 'devos/display-care.json').write_text('{broken')
        self.assertEqual(self.run_helper('get')[1]['settings'], DEFAULTS)

    def test_reset_restores_the_splendid_group_and_the_backlight_only(self):
        for key, value in [('dimming', '30'), ('splendid', 'manual'), ('temperature', '30'), ('targetMode', 'on'), ('pixelRefresh', 'off')]:
            self.run_helper('set', key, value)
        code, out, _ = self.run_helper('reset')
        self.assertEqual(code, 0)
        settings = out['settings']
        self.assertEqual((settings['dimming'], settings['splendid'], settings['temperature'], settings['gamut']), (100, 'normal', 0, 'native'))
        self.assertTrue(settings['targetMode']); self.assertFalse(settings['pixelRefresh'])
        self.assertEqual(out['brightness'], {'ok': True, 'percent': 70})
        self.assertIn('set 70', Path(self.log).read_text())

    def test_reset_reports_a_missing_backlight_instead_of_hiding_it(self):
        broken = os.path.join(self.dir, 'broken'); Path(broken).write_text('#!/bin/sh\necho No kernel backlight device is available.\nexit 1\n'); os.chmod(broken, 0o755)
        code, out, _ = self.run_helper('reset', DEVOS_DISPLAY_BACKLIGHT=broken)
        self.assertEqual(code, 0); self.assertFalse(out['brightness']['ok']); self.assertIn('No kernel backlight', out['brightness']['reason'])

    def test_ramp_maths(self):
        cases = [{}, {'dimming': 0}, {'dimming': 50}, {'splendid': 'manual', 'temperature': -50}, {'splendid': 'manual', 'temperature': 50},
                 {'splendid': 'manual', 'temperature': 0}, {'splendid': 'eyecare', 'eyeCare': 1}, {'splendid': 'eyecare', 'eyeCare': 5}, {'splendid': 'vivid'}]
        (is_identity, identity), (_, dim), (_, half), (_, warm), (_, cool), (_, neutral), (_, low), (_, high), (_, vivid) = ramps(*cases)
        self.assertTrue(is_identity); self.assertEqual(identity[0][0], 0); self.assertEqual(identity[0][-1], 65535)
        self.assertEqual(dim[1][-1], round(65535 * 0.25), 'Dimming never goes black')
        self.assertEqual(half[0][-1], round(65535 * 0.625))
        self.assertTrue(warm[2][-1] < warm[0][-1] and cool[0][-1] < cool[2][-1], 'Negative is warm, positive is cool')
        self.assertEqual(max(warm[0][-1], warm[1][-1], warm[2][-1], cool[0][-1], cool[1][-1], cool[2][-1]), 65535, 'Temperature only removes light')
        self.assertEqual(neutral, identity)
        self.assertAlmostEqual(high[2][-1] / 65535, 0.70, places=2); self.assertTrue(high[2][-1] < low[2][-1] < 65535 and high[0][-1] == 65535)
        self.assertTrue(vivid[0][SIZE // 4] < identity[0][SIZE // 4] and vivid[0][3 * SIZE // 4] > identity[0][3 * SIZE // 4] and vivid[0][-1] == 65535, 'Vivid is an S-curve with fixed end points')
        for table in (dim, warm, cool, vivid):
            for channel in table: self.assertEqual(channel, sorted(channel), 'Ramps are monotonic')

    def test_get_probes_the_compositor(self):
        self.compositor()
        code, out, _ = self.run_helper('get', WAYLAND_DISPLAY='wayland-test')
        self.assertTrue(out['gamma']['available'] and out['idle']['available'], out)
        self.assertEqual(code, 0)

    def test_get_explains_missing_protocols(self):
        self.compositor(gamma=False, idle=False)
        _, out, _ = self.run_helper('get', WAYLAND_DISPLAY='wayland-test')
        self.assertFalse(out['gamma']['available']); self.assertIn('wlr-gamma-control', out['gamma']['reason'])
        self.assertFalse(out['idle']['available']); self.assertIn('idle', out['idle']['reason'])

    def test_battery_state_for_adaptive_edge(self):
        sys_root = Path(self.dir, 'sys/class/power_supply')
        for name, kind, online in (('BAT0', 'Battery', None), ('AC', 'Mains', '0')):
            (sys_root / name).mkdir(parents=True); (sys_root / name / 'type').write_text(kind + '\n')
            if online is not None: (sys_root / name / 'online').write_text(online + '\n')
        self.assertEqual(self.run_helper('get')[1]['battery'], {'present': True, 'onBattery': True})
        (sys_root / 'AC/online').write_text('1\n')
        self.assertEqual(self.run_helper('get')[1]['battery'], {'present': True, 'onBattery': False})

    def serve(self, server, **extra):
        return subprocess.Popen(['sh', str(HELPER), 'serve'], env=self.env(WAYLAND_DISPLAY='wayland-test', **extra), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)

    def stop_group(self, child):
        # The launcher execs d, which runs the program in a child (devrun): stop the whole process group.
        if child.poll() is None:
            try: os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: child.wait(5)
            except subprocess.TimeoutExpired: os.killpg(child.pid, signal.SIGKILL)

    def wait(self, check, seconds=10):
        end = time.time() + seconds
        while time.time() < end:
            if check(): return True
            time.sleep(0.05)
        return False

    def test_serve_sends_the_saved_ramp_and_follows_changes(self):
        server = self.compositor()
        self.run_helper('set', 'dimming', '50')
        child = self.serve(server); self.addCleanup(self.stop_group, child)
        self.assertTrue(self.wait(lambda: server.ramps), 'A ramp reaches the compositor')
        red, green, blue = server.ramps[-1][:SIZE], server.ramps[-1][SIZE:2 * SIZE], server.ramps[-1][2 * SIZE:]
        self.assertEqual((red[-1], green[-1], blue[-1]), (round(65535 * 0.625),) * 3)
        self.run_helper('set', 'splendid', 'eyecare'); self.run_helper('set', 'eyeCare', '5')
        self.assertTrue(self.wait(lambda: server.ramps[-1][-1] < server.ramps[-1][SIZE - 1]), 'Eye Care lowers the blue table below red')
        self.run_helper('reset')
        self.assertTrue(self.wait(lambda: server.released >= 1), 'All-default settings release the gamma control')
        self.stop_group(child)

    def test_serve_leaves_outputs_that_another_client_controls(self):
        server = self.compositor(take_gamma=False)
        self.run_helper('set', 'dimming', '60')
        child = self.serve(server, DEVOS_DISPLAY_ONCE='1'); self.addCleanup(self.stop_group, child)
        child.wait(15); self.assertEqual(child.returncode, 0); self.assertIn('another client controls the gamma', child.stderr.read()); self.assertEqual(server.ramps, [])

    def test_pixel_refresh_flag_follows_idle_notifications(self):
        server = self.compositor()
        child = self.serve(server, DEVOS_DISPLAY_IDLE_MS='12345'); self.addCleanup(self.stop_group, child)
        flag = Path(self.runtime, 'devos-pixel-refresh')
        self.assertTrue(self.wait(lambda: server.timeouts), 'An idle notification is requested'); self.assertEqual(server.timeouts, [12345])
        server.idled(True); self.assertTrue(self.wait(flag.exists), 'Idle creates the flag')
        server.idled(False); self.assertTrue(self.wait(lambda: not flag.exists()), 'Activity removes it')
        server.idled(True); self.assertTrue(self.wait(flag.exists))
        self.run_helper('set', 'pixelRefresh', 'off')
        self.assertTrue(self.wait(lambda: not flag.exists() and server.idle_object is None), 'Turning Pixel refresh off cancels the notification and clears the flag')
        self.stop_group(child)

    def test_only_one_serve_runs_per_session(self):
        server = self.compositor()
        first = self.serve(server); self.addCleanup(self.stop_group, first)
        self.assertTrue(self.wait(lambda: server.timeouts), 'The first copy is running')
        second = self.serve(server); self.addCleanup(self.stop_group, second)
        second.wait(10); self.assertEqual(second.returncode, 0, 'A second copy leaves quietly')
        self.assertIsNone(first.poll()); self.stop_group(first)

    def test_serve_exits_when_the_compositor_offers_nothing(self):
        server = self.compositor(gamma=False, idle=False)
        child = self.serve(server); self.addCleanup(self.stop_group, child)
        child.wait(15); self.assertEqual(child.returncode, 0); self.assertIn('neither', child.stderr.read())


if __name__ == '__main__':
    unittest.main()
