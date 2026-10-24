import json
import os
import unittest
from bridge_support import BridgeFixture


class TouchpadTests(unittest.TestCase):
    def setUp(self):
        self.bridge = BridgeFixture('bin/dev-os-touchpad')
        self.addCleanup(self.bridge.close)
        self.env = {'XDG_CONFIG_HOME': str(self.bridge.root/'config'), 'DEV_OS_COMPOSITOR_CONFIG': '', 'LABWC_PID': ''}
        with self.bridge.file.open('a') as file:
            file.write('\nfn xml(text: str, value: json.Value): str { return touchpad.applyXml(text, value) }\n')
        self.settings = {'tap': True, 'drag': True, 'natural': True, 'typing': True, 'leftHanded': False, 'speed': 50}

    def request(self, request, env=None):
        result = self.bridge.cli(request, self.env | (env or {}))
        return result, json.loads(result.stdout.splitlines()[-1])

    def test_defaults_and_per_user_save_without_live_compositor(self):
        _, state = self.request({'action':'get'})
        self.assertEqual(state['settings'], self.settings)
        values = self.settings | {'speed':75, 'natural':False}
        result, state = self.request({'action':'save','settings':values})
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse(state['applied'])
        self.assertEqual(json.loads((self.bridge.root/'config/dev-os/touchpad.json').read_text()),values)
        _, state = self.request({'action':'reset'})
        self.assertEqual(state['settings'],self.settings)

    def test_invalid_values_are_rejected_before_writes(self):
        for change in ({'speed':101},{'speed':-1},{'speed':50.5},{'speed':'50'},{'tap':'yes'}):
            result, response = self.request({'action':'save','settings':self.settings|change})
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(response['ok'])
            self.assertFalse((self.bridge.root/'config/dev-os/touchpad.json').exists())

    def test_xml_changes_only_touchpad_category(self):
        original='<labwc_config><keyboard>keep</keyboard><desktops number="4"/><libinput><device category="mouse"><pointerSpeed>0.2</pointerSpeed></device><device category="touchpad"><tap>yes</tap></device></libinput></labwc_config>'
        values=self.settings|{'speed':75,'tap':False}
        xml=self.bridge.value(f'bridge.xml({json.dumps(original)},json.parse({json.dumps(json.dumps(values))}))')
        self.assertIn('<keyboard>keep</keyboard>',xml)
        self.assertIn('<desktops number="4"/>',xml)
        self.assertIn('<device category="mouse"><pointerSpeed>0.2</pointerSpeed></device>',xml)
        self.assertIn('<tap>no</tap>',xml)
        self.assertIn('<pointerSpeed>0.5</pointerSpeed>',xml)
        self.assertEqual(xml.count('category="touchpad"'),1)
        repeated=self.bridge.value(f'bridge.xml({json.dumps(xml)},json.parse({json.dumps(json.dumps(values))}))')
        self.assertEqual(xml,repeated)

    def test_live_apply_uses_only_verified_compositor_and_preserves_xml(self):
        runtime=self.bridge.root/'runtime'; runtime.mkdir()
        (runtime/'.devos-base').write_text('/fixture')
        (runtime/'rc.xml').write_text('<labwc_config><keyboard>keep</keyboard><libinput/></labwc_config>')
        proc=self.bridge.root/'proc/123'; proc.mkdir(parents=True); (proc/'comm').write_text('labwc\n')
        self.bridge.replace_text('/proc/${pid}/comm',str(self.bridge.root/'proc')+'/${pid}/comm')
        posix=self.bridge.root/'lib/posix.dev'
        source=posix.read_text(); start=source.index('fn send('); end=source.index('\nfn killGroup',start)
        posix.write_text(source[:start]+'fn send(pid: i64, sig: i32): bool { return pid == 123 }\n'+source[end:])
        _, state=self.request({'action':'save','settings':self.settings|{'speed':0}}, {'DEV_OS_COMPOSITOR_CONFIG':str(runtime),'LABWC_PID':'123'})
        self.assertTrue(state['ok'],state)
        self.assertTrue(state['applied'])
        self.assertIn('<keyboard>keep</keyboard>',(runtime/'rc.xml').read_text())
        self.assertIn('<pointerSpeed>-1</pointerSpeed>',(runtime/'rc.xml').read_text())


if __name__ == '__main__':
    unittest.main()
