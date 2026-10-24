import json
import shutil
import unittest
from bridge_support import BridgeFixture
from devlang_support import ROOT

class RadioTests(unittest.TestCase):
    def setUp(self):
        self.bridge=BridgeFixture('native/radio-system.dev'); self.addCleanup(self.bridge.close)
        self.state=self.bridge.root/'state'; self.state.mkdir()
        self.log=self.state/'commands'; self.inventory=self.state/'inventory.json'
        self.inventory.write_text(json.dumps([{'id':1,'type':'wlan','device':'phy0','soft':'unblocked','hard':'unblocked'},{'id':2,'type':'bluetooth','device':'hci0','soft':'blocked','hard':'unblocked'}]))
        source=(ROOT/'native/privileged.dev').read_text()
        # Private fixture replaces privileged filesystem plumbing, never actual radio access.
        (self.bridge.root/'native/privileged.dev').write_text(source)
        from pathlib import Path
        old=self.bridge.file; self.bridge.file=self.bridge.root/'native/privileged.dev'
        self.bridge.replace('root','fn root(): bool { return true }')
        self.bridge.replace('stateDirectory','fn stateDirectory() {}')
        self.bridge.replace('lock','fn lock(file: str): i32 { return 1 }')
        self.bridge.replace('unlock','fn unlock(fd: i32) {}')
        self.bridge.replace('trusted','fn trusted(file: str): str { return fs.readFileSync(file,"utf8") }')
        self.bridge.replace('save','fn save(file: str, text: str) { fs.writeFileSync(file,text) }')
        self.bridge.file=old
        self.bridge.replace_text('/var/lib/devos/',str(self.state)+'/')
        self.bridge.replace('inventory',f'fn inventory(): json.Value {{ return json.parse(fs.readFileSync({json.dumps(str(self.inventory))},"utf8")) }}')
        self.bridge.replace('rfkill',f'fn rfkill(args: Vec<str>): str {{ fs.appendFileSync({json.dumps(str(self.log))},strings.join(args," ")+"\\n"); return "" }}')

    def apply(self,enabled):
        return self.bridge.invoke('return bridge.apply(json.parse('+json.dumps(json.dumps({'enabled':enabled}))+'))')

    def test_restores_previous_blocks_and_does_not_overwrite_snapshot(self):
        self.assertTrue(self.apply(True)['value']['ok'])
        original=json.loads((self.state/'radio.json').read_text())
        values=json.loads(self.inventory.read_text())
        for value in values: value['soft']='blocked'
        self.inventory.write_text(json.dumps(values))
        self.assertTrue(self.apply(True)['value']['ok'])
        self.assertEqual(json.loads((self.state/'radio.json').read_text()),original)
        self.assertTrue(self.apply(False)['value']['ok'])
        self.assertEqual(self.log.read_text().splitlines(),['block all','block all','unblock all','block 2'])
        self.assertFalse(json.loads((self.state/'radio.json').read_text())['enabled'])

    def test_invalid_request_and_missing_hardware_do_not_change_radios(self):
        self.assertIn('error',self.apply('true'))
        self.inventory.write_text('[]')
        self.assertIn('error',self.apply(True))
        self.assertFalse(self.log.exists())

if __name__=='__main__': unittest.main()
