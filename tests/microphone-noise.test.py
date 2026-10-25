#!/usr/bin/env python3
"""Tests bin/dev-os-microphone against a fake PipeWire graph: fake pw-dump / wpctl / systemctl / pipewire programs share one
JSON file, so selecting a default or starting the filter service changes what the next pw-dump reports."""
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'bin' / 'dev-os-microphone'

FAKE_PW_DUMP = '#!/usr/bin/env python3\nimport os,sys\nsys.stdout.write(open(os.environ["FAKE_GRAPH"]).read())\n'
FAKE_WPCTL = '''#!/usr/bin/env python3
import json, os, sys
open(os.environ["FAKE_LOG"], "a").write("wpctl " + " ".join(sys.argv[1:]) + "\\n")
graph = json.load(open(os.environ["FAKE_GRAPH"]))
if sys.argv[1] == "set-default":
    node = next(o for o in graph if o["id"] == int(sys.argv[2]))
    key = "default.audio.source" if node["info"]["props"]["media.class"] == "Audio/Source" else "default.audio.sink"
    meta = next(o for o in graph if o["type"].endswith("Metadata"))
    meta["metadata"] = [m for m in meta["metadata"] if m["key"] != key] + [{"subject": 0, "key": key, "type": "Spa:String:JSON", "value": {"name": node["info"]["props"]["node.name"]}}]
    json.dump(graph, open(os.environ["FAKE_GRAPH"], "w"))
'''
# `start`/`restart` create the virtual source and (like WirePlumber might) make the reference sink the default output.
FAKE_SYSTEMCTL = '''#!/usr/bin/env python3
import json, os, sys
open(os.environ["FAKE_LOG"], "a").write("systemctl " + " ".join(sys.argv[1:]) + "\\n")
if os.environ.get("FAKE_SYSTEMCTL_FAIL"): print("Failed to start devos-microphone.service: Access denied"); sys.exit(1)
if os.environ.get("FAKE_UNIT_MISSING") and sys.argv[3] == "devos-microphone.service" and sys.argv[2] in ("start", "restart"): print("Failed to " + sys.argv[2] + " devos-microphone.service: Unit devos-microphone.service not found."); sys.exit(5)
graph = [o for o in json.load(open(os.environ["FAKE_GRAPH"])) if o["id"] not in (98, 99)]
if sys.argv[2] in ("start", "restart"):
    state = json.load(open(os.path.join(os.environ["XDG_CONFIG_HOME"], "devos", "microphone.json")))
    graph.append({"id": 99, "type": "PipeWire:Interface:Node", "info": {"props": {"node.name": "devos-mic-clean", "media.class": "Audio/Source", "devos.mic.mode": state["mode"]}}})
    graph.append({"id": 98, "type": "PipeWire:Interface:Node", "info": {"props": {"node.name": "devos-mic-reference", "media.class": "Audio/Sink"}}})
    meta = next(o for o in graph if o["type"].endswith("Metadata"))
    meta["metadata"] = [m for m in meta["metadata"] if m["key"] != "default.audio.sink"] + [{"subject": 0, "key": "default.audio.sink", "type": "Spa:String:JSON", "value": {"name": "devos-mic-reference"}}]
json.dump(graph, open(os.environ["FAKE_GRAPH"], "w"))
'''
FAKE_SYSTEMD_RUN = '''#!/usr/bin/env python3
import os, sys
open(os.environ["FAKE_LOG"], "a").write("systemd-run " + " ".join(sys.argv[1:]) + "\\n")
os.execv(os.environ["DEVOS_MIC_SYSTEMCTL"], ["x", "--user", "start", "transient"])
'''
FAKE_PIPEWIRE = '#!/usr/bin/env python3\nimport os,shutil,sys\nshutil.copy(sys.argv[2], os.environ["FAKE_PIPEWIRE_CONF"])\n'


def node(identifier, name, klass, description='', **extra):
    props = {'node.name': name, 'media.class': klass, 'node.description': description, **extra}
    return {'id': identifier, 'type': 'PipeWire:Interface:Node', 'info': {'props': props}}


def graph(default_source='alsa_input.mic_array', default_sink='alsa_output.speakers'):
    return [
        node(40, 'alsa_input.mic_array', 'Audio/Source', 'Microphone Array (Qualcomm)'),
        node(41, 'alsa_input.usb_headset', 'Audio/Source', 'USB Headset Mono'),
        node(50, 'alsa_output.speakers', 'Audio/Sink', 'Speakers'),
        node(51, 'alsa_output.speakers.monitor', 'Audio/Source/Virtual', 'Monitor of Speakers'),
        node(60, 'bluez_input.camera', 'Video/Source', 'Not audio'),
        {'id': 30, 'type': 'PipeWire:Interface:Metadata', 'info': {'props': {}}, 'metadata': [
            {'subject': 0, 'key': 'default.audio.source', 'type': 'Spa:String:JSON', 'value': json.dumps({'name': default_source})},
            {'subject': 0, 'key': 'default.audio.sink', 'type': 'Spa:String:JSON', 'value': {'name': default_sink}}]},
    ]


class MicrophoneTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        base = Path(self.directory.name)
        self.graph, self.log = base / 'graph.json', base / 'log'
        self.log.write_text('')
        for name, text in (('pw-dump', FAKE_PW_DUMP), ('wpctl', FAKE_WPCTL), ('systemctl', FAKE_SYSTEMCTL), ('pipewire', FAKE_PIPEWIRE), ('systemd-run', FAKE_SYSTEMD_RUN)):
            (base / name).write_text(text)
            (base / name).chmod(0o755)
        self.libs = base / 'lib'
        self.install_plugins(True)
        self.env = {**os.environ, 'FAKE_GRAPH': str(self.graph), 'FAKE_LOG': str(self.log), 'XDG_CONFIG_HOME': str(base / 'config'),
                    'DEVOS_MIC_PW_DUMP': str(base / 'pw-dump'), 'DEVOS_MIC_WPCTL': str(base / 'wpctl'), 'DEVOS_MIC_SYSTEMCTL': str(base / 'systemctl'),
                    'DEVOS_MIC_PIPEWIRE': str(base / 'pipewire'), 'DEVOS_MIC_SYSTEMD_RUN': str(base / 'systemd-run'), 'DEVOS_MIC_LIBDIRS': str(self.libs), 'DEVOS_MIC_WAIT': '1',
                    'FAKE_PIPEWIRE_CONF': str(base / 'served.conf')}
        self.write_graph(graph())
        self.base = base

    def tearDown(self):
        self.directory.cleanup()

    def install_plugins(self, present):
        for path in (self.libs / 'pipewire-0.3' / 'libpipewire-module-echo-cancel.so', self.libs / 'spa-0.2' / 'aec' / 'libspa-aec-webrtc.so'):
            if present:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('')
            elif path.exists():
                path.unlink()

    def write_graph(self, objects):
        self.graph.write_text(json.dumps(objects))

    def run_helper(self, *args, expect=0, env=None):
        done = subprocess.run([sys.executable, str(HELPER), *args], capture_output=True, text=True, env={**self.env, **(env or {})}, timeout=60)
        self.assertEqual(done.returncode, expect, done.stdout + done.stderr)
        return json.loads(done.stdout) if done.stdout.strip().startswith('{') else done.stdout

    def default(self, key):
        meta = next(o for o in json.loads(self.graph.read_text()) if o['type'].endswith('Metadata'))
        value = next(m['value'] for m in meta['metadata'] if m['key'] == key)
        return (json.loads(value) if isinstance(value, str) else value)['name']

    def calls(self):
        return self.log.read_text().splitlines()

    def test_lists_only_real_microphones_and_reports_defaults(self):
        state = self.run_helper('get')
        self.assertTrue(state['ok'] and state['supported'])
        self.assertEqual([s['name'] for s in state['sources']], ['alsa_input.mic_array', 'alsa_input.usb_headset'], 'monitors, sinks and cameras are not microphones')
        self.assertEqual(state['sources'][0]['title'], 'Microphone Array (Qualcomm)')
        self.assertEqual((state['device'], state['mode'], state['active'], state['running']), ('alsa_input.mic_array', 'authentic', 'authentic', False))
        self.assertEqual(state['noise'], {'available': True, 'reason': ''})
        self.assertEqual(self.calls(), [], 'Reading the state changes nothing')

    def test_noise_modes_are_unavailable_without_the_plugins(self):
        self.install_plugins(False)
        state = self.run_helper('get')
        self.assertFalse(state['noise']['available'])
        self.assertIn('pipewire-modules-echo-cancel', state['noise']['reason'])
        self.assertIn('pipewire-spa-plugins-aec-webrtc', state['noise']['reason'])
        refused = self.run_helper('mode', 'general', expect=1)
        self.assertFalse(refused['ok'])
        self.assertIn('not installed', refused['error'])
        self.assertEqual(self.run_helper('get')['mode'], 'authentic', 'A refused mode is not saved')
        self.assertFalse(any(call.startswith('systemctl') for call in self.calls()))

    def test_saved_noise_mode_without_plugins_falls_back_with_a_warning(self):
        (self.base / 'config' / 'devos').mkdir(parents=True)
        (self.base / 'config' / 'devos' / 'microphone.json').write_text(json.dumps({'mode': 'conference', 'device': ''}))
        self.install_plugins(False)
        state = self.run_helper('get')
        self.assertEqual((state['mode'], state['active']), ('conference', 'authentic'))
        self.assertIn('without processing', state['warning'])

    def test_general_mode_makes_the_virtual_source_the_default_and_keeps_the_speakers(self):
        state = self.run_helper('mode', 'general')
        self.assertEqual((state['mode'], state['active'], state['running']), ('general', 'general', True))
        self.assertEqual(self.default('default.audio.source'), 'devos-mic-clean')
        self.assertEqual(self.default('default.audio.sink'), 'alsa_output.speakers', 'The reference sink never becomes the default output')
        self.assertIn('systemctl --user restart devos-microphone.service', self.calls())
        self.assertEqual([s['name'] for s in state['sources']], ['alsa_input.mic_array', 'alsa_input.usb_headset'], 'The virtual source is not offered as a device')
        self.assertEqual(state['device'], 'alsa_input.mic_array')

    def test_conference_mode_is_reported_and_authentic_restores_the_raw_microphone(self):
        self.assertEqual(self.run_helper('mode', 'conference')['active'], 'conference')
        state = self.run_helper('mode', 'authentic')
        self.assertEqual((state['active'], state['running']), ('authentic', False))
        self.assertEqual(self.default('default.audio.source'), 'alsa_input.mic_array')
        self.assertIn('systemctl --user stop devos-microphone.service', self.calls())

    def test_choosing_a_device_in_each_mode(self):
        state = self.run_helper('device', 'alsa_input.usb_headset')
        self.assertEqual((state['device'], state['active']), ('alsa_input.usb_headset', 'authentic'))
        self.assertEqual(self.default('default.audio.source'), 'alsa_input.usb_headset', 'Authentic recording selects the raw device')
        self.run_helper('mode', 'general')
        self.assertEqual(self.default('default.audio.source'), 'devos-mic-clean')
        state = self.run_helper('device', 'alsa_input.mic_array')
        self.assertEqual((state['device'], state['active']), ('alsa_input.mic_array', 'general'))
        self.assertEqual(self.default('default.audio.source'), 'devos-mic-clean', 'Switching the microphone keeps the filter on')
        self.assertEqual(json.loads((self.base / 'config' / 'devos' / 'microphone.json').read_text()), {'mode': 'general', 'device': 'alsa_input.mic_array'})

    def test_rejects_unknown_devices_modes_and_our_own_nodes(self):
        for args in (('device', 'alsa_input.gone'), ('device', 'devos-mic-clean'), ('mode', 'studio'), ('mode',), ('frobnicate',)):
            result = self.run_helper(*args, expect=1)
            self.assertFalse(result['ok'], args)
        self.assertEqual(self.calls(), [])

    def test_service_failure_is_reported(self):
        failed = self.run_helper('mode', 'general', expect=1, env={'FAKE_SYSTEMCTL_FAIL': '1'})
        self.assertIn('could not start', failed['error'])

    def test_apply_at_login_starts_the_saved_mode_without_restarting_it(self):
        (self.base / 'config' / 'devos').mkdir(parents=True)
        (self.base / 'config' / 'devos' / 'microphone.json').write_text(json.dumps({'mode': 'conference', 'device': 'alsa_input.usb_headset'}))
        state = self.run_helper('apply')
        self.assertEqual(state['active'], 'conference')
        self.assertIn('systemctl --user start devos-microphone.service', self.calls())
        self.assertNotIn('systemctl --user restart devos-microphone.service', self.calls())
        self.assertEqual(self.default('default.audio.source'), 'devos-mic-clean')

    def test_without_the_user_unit_a_transient_unit_runs_the_filter(self):
        state = self.run_helper('mode', 'general', env={'FAKE_UNIT_MISSING': '1'})
        self.assertEqual((state['active'], state['running']), ('general', True))
        run = [call for call in self.calls() if call.startswith('systemd-run')]
        self.assertEqual(len(run), 1)
        self.assertIn('--unit=devos-microphone-session.service', run[0])
        self.assertTrue(run[0].endswith('dev-os-microphone serve'))
        self.assertIn('systemctl --user stop devos-microphone-session.service', self.calls())
        self.run_helper('mode', 'authentic', env={'FAKE_UNIT_MISSING': '1'})
        self.assertEqual(self.default('default.audio.source'), 'alsa_input.mic_array')

    def test_pipewire_not_running(self):
        (self.base / 'pw-dump').write_text('#!/bin/sh\nexit 1\n')
        state = self.run_helper('get')
        self.assertFalse(state['supported'])
        self.assertIn('PipeWire', state['reason'])
        self.assertFalse(self.run_helper('mode', 'authentic', expect=1)['ok'])

    def test_corrupt_state_is_authentic(self):
        (self.base / 'config' / 'devos').mkdir(parents=True)
        (self.base / 'config' / 'devos' / 'microphone.json').write_text('{"mode": "evil; rm -rf /", "device": 5')
        state = self.run_helper('get')
        self.assertEqual(state['mode'], 'authentic')

    def serve(self, mode, device='alsa_input.usb_headset'):
        (self.base / 'config' / 'devos').mkdir(parents=True, exist_ok=True)
        (self.base / 'config' / 'devos' / 'microphone.json').write_text(json.dumps({'mode': mode, 'device': device}))
        self.run_helper('serve')
        served = self.base / 'served.conf'
        return served.read_text() if served.exists() else None

    def test_generated_pipewire_config(self):
        general = self.serve('general')
        for expected in ('libpipewire-module-echo-cancel', 'aec/libspa-aec-webrtc', 'webrtc.noise_suppression = true', 'webrtc.gain_control = false',
                         'target.object = "alsa_input.usb_headset"', 'node.name = "devos-mic-clean"', 'devos.mic.mode = "general"'):
            self.assertIn(expected, general)
        self.assertNotIn('beamforming', general, 'No beamformer is configured or claimed')
        conference = self.serve('conference')
        self.assertIn('webrtc.gain_control = true', conference)
        self.assertIn('devos.mic.mode = "conference"', conference)

    def test_serve_does_nothing_for_authentic_missing_plugins_or_missing_microphone(self):
        self.assertIsNone(self.serve('authentic'))
        self.install_plugins(False)
        self.assertIsNone(self.serve('general'))
        self.install_plugins(True)
        self.write_graph([o for o in graph() if o['type'].endswith('Metadata')])
        self.assertIsNone(self.serve('general'))

    def test_serve_falls_back_to_a_present_microphone_when_the_saved_one_is_gone(self):
        self.assertIn('target.object = "alsa_input.mic_array"', self.serve('general', 'alsa_input.unplugged'))


class WiringTests(unittest.TestCase):
    def test_image_and_session_recipes_ship_the_filter(self):
        image = (ROOT / 'distro/oe/meta-devos/recipes-core/images/devos-image.bb').read_text()
        for package in ('pipewire-tools', 'pipewire-modules-echo-cancel', 'pipewire-spa-plugins-aec-webrtc'):
            self.assertIn(' ' + package + ' ', image)
        session = ROOT / 'distro/oe/meta-devos/recipes-devos/session'
        recipe = (session / 'devos-session.bb').read_text()
        self.assertIn('file://devos-microphone.service', recipe)
        self.assertIn('${systemd_user_unitdir}', recipe)
        unit = (session / 'files/devos-microphone.service').read_text()
        self.assertIn('ExecStart=/usr/bin/dev-os-microphone serve', unit)
        self.assertIn('ExecStartPost=-/usr/bin/dev-os-microphone finish', unit)
        self.assertIn('devos-microphone.service', (session / 'files/devos-desktop').read_text())
        self.assertIn('dev-os-microphone apply', (ROOT / 'distro/usb/root-session').read_text())


if __name__ == '__main__':
    unittest.main()
