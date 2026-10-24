import json
import unittest
from bridge_support import BridgeFixture

class InputTests(unittest.TestCase):
    def setUp(self):
        self.bridge = BridgeFixture('bin/dev-os-input-settings')
        self.addCleanup(self.bridge.close)
        self.env = {'XDG_CONFIG_HOME': str(self.bridge.root/'config'), 'DEV_OS_COMPOSITOR_CONFIG': '', 'LABWC_PID': ''}
        with self.bridge.file.open('a') as file:
            file.write('\nfn xml(text: str, kind: str, values: json.Value): str { return input.applyXml(text, kind, values) }\n')

    def request(self, kind, action, settings=None):
        result = self.bridge.cli({'kind': kind, 'action': action, 'settings': settings}, self.env)
        return result, json.loads(result.stdout.splitlines()[-1])

    def test_independent_preferences_and_reset(self):
        for kind, values in [('mouse', {'speed':75,'natural':True,'leftHanded':True}), ('keyboard', {'repeat':False,'delay':600,'rate':35})]:
            result, state = self.request(kind, 'save', values)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(state['settings'], values)
            self.assertFalse(state['applied'])
        self.assertEqual(self.request('mouse','get')[1]['settings']['speed'],75)
        self.assertEqual(self.request('keyboard','reset')[1]['settings']['rate'],25)
        self.assertEqual(self.request('mouse','get')[1]['settings']['speed'],75)

    def test_reject_invalid_before_writing(self):
        for kind, value in [('mouse',{'speed':101,'natural':False,'leftHanded':False}), ('mouse',{'speed':'50','natural':False,'leftHanded':False}), ('keyboard',{'repeat':True,'delay':99,'rate':25}), ('keyboard',{'repeat':True,'delay':500,'rate':6.5}), ('bad',{})]:
            result,state=self.request(kind,'save',value)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(state['ok'])

    def test_xml_preserves_touchpad_shortcuts_and_desktops(self):
        xml='<labwc_config><keyboard><keybind key="A-a"/><repeatRate>25</repeatRate></keyboard><desktops number="4"/><libinput><device category="touchpad"><tap>yes</tap></device></libinput></labwc_config>'
        mouse={'speed':0,'natural':False,'leftHanded':True}
        updated=self.bridge.value(f'bridge.xml({json.dumps(xml)},"mouse",json.parse({json.dumps(json.dumps(mouse))}))')
        self.assertIn('<device category="touchpad"><tap>yes</tap></device>',updated)
        self.assertIn('<device category="non-touch"><pointerSpeed>-1</pointerSpeed>',updated)
        keyboard={'repeat':False,'delay':700,'rate':30}
        updated=self.bridge.value(f'bridge.xml({json.dumps(updated)},"keyboard",json.parse({json.dumps(json.dumps(keyboard))}))')
        self.assertIn('<keybind key="A-a"/>',updated)
        self.assertIn('<desktops number="4"/>',updated)
        self.assertIn('<repeatRate>0</repeatRate>',updated)
        self.assertEqual(updated.count('<repeatRate>'),1)

if __name__ == '__main__': unittest.main()
