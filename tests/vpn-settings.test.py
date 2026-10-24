import json
import os
from pathlib import Path
import tempfile
import unittest
from devlang_support import run_source, use

class VpnTests(unittest.TestCase):
    def execute(self,username,password,env):
        source=use('network-settings','network')+'use "std/json"\nuse "std/result"\nlet outcome=result.run(fn() { network.connectVpn("fixture-id",'+json.dumps(username)+','+json.dumps(password)+') })\nif result.isErr(outcome) { print(json.stringify({ok:false,error:result.message(outcome)})) } else { print("{\\"ok\\":true}") }'
        return json.loads(run_source(source,ffi=True,env=env))

    def test_secret_file_permissions_cleanup_and_no_secret_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); log=root/'calls'
            tool=root/'nmcli'
            tool.write_text('''#!/usr/bin/python3
import json,os,sys
from pathlib import Path
value={'args':sys.argv[1:]}
if 'passwd-file' in sys.argv:
 p=Path(sys.argv[sys.argv.index('passwd-file')+1]);value.update(path=str(p),mode=p.stat().st_mode&0o777,content=p.read_text())
with open(os.environ['TEST_NMCLI_LOG'],'a') as output:output.write(json.dumps(value)+'\\n')
sys.exit(int(os.getenv('TEST_NMCLI_EXIT','0')))
'''); tool.chmod(0o755)
            env={'PATH':str(root)+':'+os.environ['PATH'],'TEST_NMCLI_LOG':str(log)}
            for code in [0,1]:
                value=self.execute('', 'fake private password',env|{'TEST_NMCLI_EXIT':str(code)})
                self.assertEqual(value['ok'],code==0,value)
                call=json.loads(log.read_text().splitlines()[-1])
                self.assertNotIn('fake private password',str(call['args']))
                self.assertEqual(call['mode'],0o600)
                self.assertEqual(call['content'],'vpn.secrets.password:fake private password\n')
                self.assertFalse(Path(call['path']).exists())

    def test_invalid_credentials_rejected_before_commands(self):
        for username,password in [('bad\nname','password'),('name','bad\npassword')]:
            value=self.execute(username,password,{'PATH':'/nonexistent'})
            self.assertFalse(value['ok'])
            self.assertIn('Invalid VPN',value['error'])

if __name__=='__main__':unittest.main()
