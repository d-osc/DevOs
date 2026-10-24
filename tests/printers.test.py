import json
import unittest
from bridge_support import BridgeFixture

class PrinterTests(unittest.TestCase):
    def setUp(self):
        self.bridge=BridgeFixture('bin/dev-os-printers')
        self.addCleanup(self.bridge.close)

    def test_validation(self):
        for name in ['Office','office-2','Office_3']:
            self.assertTrue(self.bridge.value(f'bridge.queueName({json.dumps(name)})'))
        for name in ['-bad','a b','a;touch /tmp/x','','x'*64]:
            self.assertFalse(self.bridge.value(f'bridge.queueName({json.dumps(name)})'))
        for uri in ['ipp://printer.local/ipp/print','ipps://192.168.1.4/ipp/print']:
            self.assertTrue(self.bridge.value(f'bridge.printerUri({json.dumps(uri)})'))
        for uri in ['file:///tmp/a','ipp://','ipp:///path','ipp://user:pass@host/a','ipp://host/\nabc','http://host/a']:
            self.assertFalse(self.bridge.value(f'bridge.printerUri({json.dumps(uri)})'))

    def test_existing_printer_actions_and_stale_selection(self):
        self.bridge.replace('snapshot', 'fn snapshot(): json.Value { return {ok:true, available:true, printers:json.parse("[{\\\"name\\\":\\\"Office\\\"}]")} }')
        self.bridge.replace('checked', 'fn checked(program: str, args: Vec<str>) {}')
        for action in ['default','remove']:
            result=self.bridge.cli({'action':action,'name':'Office'})
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        result=self.bridge.cli({'action':'remove','name':'Stale'})
        self.assertNotEqual(result.returncode,0)

    def test_add_uses_validated_argv_and_no_shell(self):
        log=self.bridge.root/'commands'
        self.bridge.replace('checked',f'fn checked(program: str, args: Vec<str>) {{ fs.writeFileSync({json.dumps(str(log))}, program + "\\n" + strings.join(args, "\\n")) }}')
        with self.bridge.file.open('a') as file: file.write('\n')
        self.bridge.replace_text('use "std/json"','use "std/json"\nuse "std/fs"')
        self.bridge.replace('snapshot','fn snapshot(): json.Value { return {ok:true, available:true, printers:json.array()} }')
        result=self.bridge.cli({'action':'add','name':'Office','uri':'ipps://printer.local/ipp/print'})
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(log.read_text().splitlines(),['lpadmin','-p','Office','-E','-v','ipps://printer.local/ipp/print','-m','everywhere'])
        result=self.bridge.cli({'action':'add','name':'Injected;cmd','uri':'ipp://host/a'})
        self.assertNotEqual(result.returncode,0)

if __name__ == '__main__': unittest.main()
