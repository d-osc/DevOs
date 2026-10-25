#!/usr/bin/env python3
"""Tests bin/dev-os-speaker (voice-only filter, sound modes, Voice Mode Smart Switch) against a fake PipeWire graph."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'bin' / 'dev-os-speaker'
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
FAKE_SYSTEMCTL = '''#!/usr/bin/env python3
import os, sys
open(os.environ["FAKE_LOG"], "a").write("systemctl " + " ".join(sys.argv[1:]) + "\\n")
if os.environ.get("FAKE_UNIT_MISSING"): print("Failed to start devos-speaker.service: Unit devos-speaker.service not found."); sys.exit(5)
'''
FAKE_SYSTEMD_RUN = '''#!/usr/bin/env python3
import os, sys
open(os.environ["FAKE_LOG"], "a").write("systemd-run " + " ".join(sys.argv[1:]) + "\\n")
'''
# The filter process creates the virtual sink, as the real one would.
FAKE_PIPEWIRE = '''#!/usr/bin/env python3
import json, os, shutil, sys
shutil.copy(sys.argv[2], os.environ["FAKE_PIPEWIRE_CONF"])
graph = json.load(open(os.environ["FAKE_GRAPH"]))
graph.append({"id": 70, "type": "PipeWire:Interface:Node", "info": {"props": {"node.name": "devos-spk-fx", "media.class": "Audio/Sink"}}})
json.dump(graph, open(os.environ["FAKE_GRAPH"], "w"))
'''


def node(identifier, name, klass, description='', **extra):
    return {'id': identifier, 'type': 'PipeWire:Interface:Node', 'info': {'props': {'node.name': name, 'media.class': klass, 'node.description': description, **extra}}}


def graph(default_sink='alsa_output.speakers', recorder=False):
    items = [node(50, 'alsa_output.speakers', 'Audio/Sink', 'Speakers (Qualcomm)'), node(52, 'alsa_output.hdmi', 'Audio/Sink', 'HDMI Display'),
             node(53, 'devos-mic-reference', 'Audio/Sink', 'not an output'), node(40, 'alsa_input.mic', 'Audio/Source', 'Mic'),
             {'id': 30, 'type': 'PipeWire:Interface:Metadata', 'info': {'props': {}}, 'metadata': [
                 {'subject': 0, 'key': 'default.audio.sink', 'type': 'Spa:String:JSON', 'value': json.dumps({'name': default_sink})}]}]
    if recorder:
        items.append(node(80, 'Firefox', 'Stream/Input/Audio', 'call'))
    return items


class SpeakerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        base = self.base = Path(self.directory.name)
        self.graph, self.log = base / 'graph.json', base / 'log'
        self.log.write_text('')
        for name, text in (('pw-dump', FAKE_PW_DUMP), ('wpctl', FAKE_WPCTL), ('systemctl', FAKE_SYSTEMCTL), ('pipewire', FAKE_PIPEWIRE), ('systemd-run', FAKE_SYSTEMD_RUN)):
            (base / name).write_text(text)
            (base / name).chmod(0o755)
        self.libs = base / 'lib'
        self.install_plugins(True)
        self.env = {**os.environ, 'FAKE_GRAPH': str(self.graph), 'FAKE_LOG': str(self.log), 'XDG_CONFIG_HOME': str(base / 'config'), 'DEVOS_MIC_PW_DUMP': str(base / 'pw-dump'),
                    'DEVOS_MIC_WPCTL': str(base / 'wpctl'), 'DEVOS_MIC_SYSTEMCTL': str(base / 'systemctl'), 'DEVOS_MIC_SYSTEMD_RUN': str(base / 'systemd-run'),
                    'DEVOS_MIC_PIPEWIRE': str(base / 'pipewire'), 'DEVOS_MIC_LIBDIRS': str(self.libs), 'DEVOS_MIC_WAIT': '1', 'FAKE_PIPEWIRE_CONF': str(base / 'served.conf')}
        self.write_graph(graph())

    def tearDown(self):
        self.directory.cleanup()

    def install_plugins(self, present):
        for path in (self.libs / 'pipewire-0.3' / 'libpipewire-module-filter-chain.so', self.libs / 'spa-0.2' / 'filter-graph' / 'libspa-filter-graph.so',
                     self.libs / 'spa-0.2' / 'filter-graph' / 'libspa-filter-graph-plugin-builtin.so'):
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

    def state_file(self):
        return json.loads((self.base / 'config' / 'devos' / 'speaker.json').read_text())

    def serve(self, **state):
        (self.base / 'config' / 'devos').mkdir(parents=True, exist_ok=True)
        (self.base / 'config' / 'devos' / 'speaker.json').write_text(json.dumps(state))
        (self.base / 'served.conf').unlink(missing_ok=True)
        self.run_helper('serve', env={'DEVOS_SPK_ONCE': '1'})
        served = self.base / 'served.conf'
        return served.read_text() if served.exists() else None

    def test_lists_real_outputs_and_defaults(self):
        state = self.run_helper('get')
        self.assertEqual([s['name'] for s in state['speakers']], ['alsa_output.speakers', 'alsa_output.hdmi'], 'Our own sinks and sources are not outputs')
        self.assertEqual((state['device'], state['mode'], state['voice'], state['smart'], state['active'], state['effective']), ('alsa_output.speakers', 'dynamic', False, True, False, 'dynamic'))
        self.assertTrue(state['filters']['available'])
        self.assertEqual(self.log.read_text(), '', 'Reading changes nothing')

    def test_settings_are_saved_and_start_the_service(self):
        self.run_helper('voice', 'on')
        self.run_helper('mode', 'movie')
        self.run_helper('smart', 'off')
        self.run_helper('device', 'alsa_output.hdmi')
        state = self.run_helper('custom', 'custom2', '4', '-20', '3')
        self.assertEqual(self.state_file(), {'mode': 'movie', 'voice': True, 'boost': False, 'smart': False, 'device': 'alsa_output.hdmi', 'custom': {'custom1': [0, 0, 0], 'custom2': [4, -10, 3], 'custom3': [0, 0, 0]}})
        self.assertEqual(state['custom']['custom2'], [4, -10, 3], 'Custom levels are limited to +-10 dB')
        self.assertIn('systemctl --user start devos-speaker.service', self.log.read_text())

    def test_rejects_bad_requests(self):
        for args in (('mode', 'dolby'), ('voice', 'maybe'), ('device', 'alsa_output.gone'), ('device', 'devos-spk-fx'), ('custom', 'custom9', '1', '1', '1'), ('custom', 'custom1', 'a', '1', '1'), ('nonsense',)):
            self.assertFalse(self.run_helper(*args, expect=1)['ok'], args)
        self.assertEqual(self.log.read_text(), '')

    def test_corrupt_state_is_dynamic(self):
        (self.base / 'config' / 'devos').mkdir(parents=True)
        (self.base / 'config' / 'devos' / 'speaker.json').write_text('{"mode": "rm -rf", "voice": "yes"')
        state = self.run_helper('get')
        self.assertEqual((state['mode'], state['voice']), ('dynamic', False))

    def test_effects_unavailable_without_the_filter_plugins(self):
        self.install_plugins(False)
        self.run_helper('voice', 'on')
        state = self.run_helper('get')
        self.assertFalse(state['filters']['available'])
        self.assertIn('pipewire-modules-filter-chain', state['filters']['reason'])
        self.assertIn('without effects', state['warning'])
        self.assertIsNone(self.serve(voice=True, mode='dynamic'), 'Nothing is started without the plugins')

    def test_voice_only_filter_graph(self):
        conf = self.serve(voice=True, mode='dynamic', smart=False)
        self.assertEqual(conf.count('label = bq_highpass'), 4)
        self.assertEqual(conf.count('label = bq_lowpass'), 4)
        self.assertIn('"Freq" = 300', conf)
        self.assertIn('"Freq" = 3400', conf)
        for expected in ('libpipewire-module-filter-chain', 'node.name = "devos-spk-fx"', 'media.class = Audio/Sink', 'target.object = "alsa_output.speakers"', 'node.dont-fallback = true'):
            self.assertIn(expected, conf)
        self.assertNotIn('label = linear', conf, 'No headroom stage when nothing is boosted')
        meta = next(o for o in json.loads(self.graph.read_text()) if o['type'].endswith('Metadata'))
        value = next(m['value'] for m in meta['metadata'] if m['key'] == 'default.audio.sink')
        self.assertEqual((json.loads(value) if isinstance(value, str) else value)['name'], 'devos-spk-fx', 'The effect sink becomes the default output')

    def test_sound_modes_and_headroom(self):
        movie = self.serve(mode='movie', smart=False)
        self.assertIn('label = bq_lowshelf', movie)
        self.assertIn('"Gain" = 5.0', movie)
        self.assertIn('label = linear', movie)
        self.assertIn('"Mult" = 0.5623', movie, '5 dB of boost is compensated by 5 dB of headroom')
        self.write_graph(graph())
        combined = self.serve(mode='music', voice=True, smart=False)
        self.assertLess(combined.index('bq_highpass'), combined.index('bq_lowshelf'), 'The voice band is filtered before the curve is applied')
        self.write_graph(graph())
        self.assertIsNone(self.serve(mode='dynamic', smart=False), 'Dynamic without voice-only is no processing at all')
        self.assertIsNone(self.serve(mode='custom1', smart=False), 'A flat custom mode is no processing either')
        custom = self.serve(mode='custom3', smart=False, custom={'custom3': [6, 0, -3]})
        self.assertIn('"Gain" = 6.0', custom)
        self.assertIn('"Gain" = -3.0', custom)

    def test_volume_booster_graph(self):
        conf = self.serve(boost=True, smart=False)
        for label in ('label = linear', 'label = abs', 'label = recip', 'label = mult'):
            self.assertIn(label, conf)
        self.assertEqual(conf.count('label = mult'), 2, 'One soft-saturation mixer per channel')
        self.assertIn('"Mult" = 3.0', conf)
        self.assertIn('"Mult" = 1.3333', conf, 'Make-up gain keeps full scale at full scale')
        self.assertIn('"Add" = 1.0', conf)
        for link in ('Lgain:Out" input = "Labs:In"', 'Lgain:Out" input = "Lmix:In 1"', 'Lrecip:Out" input = "Lmix:In 2"', 'Lmix:Out" input = "Lmakeup:In"', 'Rmix:Out" input = "Rmakeup:In"'):
            self.assertIn(link, conf)
        self.assertIn('outputs = [ "Lmakeup:Out" "Rmakeup:Out" ]', conf)
        self.assertIn('inputs = [ "Lgain:In" "Rgain:In" ]', conf)
        self.write_graph(graph())
        both = self.serve(boost=True, mode='movie', voice=True, smart=False)
        self.assertLess(both.index('bq_highpass'), both.index('bq_lowshelf'))
        self.assertLess(both.index('bq_lowshelf'), both.index('Lgain'), 'The booster is the last stage')
        self.assertEqual(self.run_helper('boost', 'on')['boost'], True)

    def test_voice_mode_smart_switch_while_an_app_records(self):
        self.write_graph(graph(recorder=True))
        state = self.run_helper('get')
        self.assertEqual((state['mode'], state['effective']), ('dynamic', 'voice'))
        self.run_helper('smart', 'off')
        self.assertEqual(self.run_helper('get')['effective'], 'dynamic')
        self.write_graph(graph() + [node(81, 'meter', 'Stream/Input/Audio', 'monitor', **{'stream.monitor': 'true'}), node(82, 'devos-mic-capture', 'Stream/Input/Audio')])
        self.run_helper('smart', 'on')
        self.assertEqual(self.run_helper('get')['effective'], 'dynamic', 'Level meters and our own filters are not calls')

    def test_service_fallback_without_the_user_unit(self):
        self.run_helper('mode', 'game', env={'FAKE_UNIT_MISSING': '1'})
        calls = self.log.read_text()
        self.assertIn('--unit=devos-speaker-session.service', calls)
        self.assertTrue(calls.strip().splitlines()[-1].endswith('dev-os-speaker serve'))

    def test_pipewire_not_running(self):
        (self.base / 'pw-dump').write_text('#!/bin/sh\nexit 1\n')
        state = self.run_helper('get')
        self.assertFalse(state['supported'])
        self.assertFalse(self.run_helper('mode', 'game', expect=1)['ok'])


class WiringTests(unittest.TestCase):
    def test_image_and_session_ship_the_service(self):
        image = (ROOT / 'distro/oe/meta-devos/recipes-core/images/devos-image.bb').read_text()
        for package in ('pipewire-modules-filter-chain', 'pipewire-spa-plugins-filter-graph', 'pipewire-spa-plugins-filter-graph-plugin-builtin'):
            self.assertIn(' ' + package + ' ', image)
        session = ROOT / 'distro/oe/meta-devos/recipes-devos/session'
        self.assertIn('file://devos-speaker.service', (session / 'devos-session.bb').read_text())
        unit = (session / 'files/devos-speaker.service').read_text()
        self.assertIn('ExecStart=/usr/bin/dev-os-speaker serve', unit)
        self.assertIn('devos-speaker.service', (session / 'files/devos-desktop').read_text())
        self.assertIn('dev-os-speaker apply', (ROOT / 'distro/usb/root-session').read_text())


if __name__ == '__main__':
    unittest.main()
