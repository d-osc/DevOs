"""Exercise feed staging and real GPG signatures with a controlled indexer fixture."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from devlang_support import D, ROOT

def publish(packages, catalog, output, url, key, architectures, indexer):
    command = [D, str(ROOT / 'tools/store/publish.dev'), '--']
    for directory in packages: command += ['--packages', str(directory)]
    command += ['--catalog', str(catalog), '--output', str(output), '--url', url, '--key', key, '--indexer', indexer]
    for architecture in architectures: command += ['--architecture', architecture]
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if result.returncode: raise ValueError(result.stdout + result.stderr)
    return len(list(Path(output).glob('*.ipk')))

publisher = SimpleNamespace(publish=publish)

@unittest.skipUnless(shutil.which('gpg'),'GPG is needed for signature testing')
class FeedTest(unittest.TestCase):
    def test_staging_and_signatures(self):
        with tempfile.TemporaryDirectory(prefix='devos-feed-test-') as temporary:
            folder=Path(temporary);home=folder/'gpg';home.mkdir(mode=0o700)
            packages=folder/'packages';packages.mkdir();(packages/'example_1_all.ipk').write_bytes(b'Controlled package fixture')
            indexer=folder/'indexer'
            indexer.write_text("#!/usr/bin/python3\nimport hashlib,pathlib,sys\np=next(pathlib.Path(sys.argv[-1]).glob('*.ipk'))\nprint('Package: devos-example\\nVersion: 1\\nArchitecture: all\\nFilename: '+str(p)+'\\nSHA256sum: '+hashlib.sha256(p.read_bytes()).hexdigest()+'\\n')\n")
            indexer.chmod(0o700)
            catalog=folder/'catalog.json';catalog.write_text(json.dumps({'schemaVersion':1,'apps':[{'id':'org.devos.Example','name':'Example','package':'devos-example'}]}))
            output=folder/'release'
            with patch.dict(os.environ,{'GNUPGHOME':str(home)}):
                try:
                    subprocess.run(['gpg','--batch','--pinentry-mode','loopback','--passphrase','','--quick-generate-key','DevOs Feed Test','ed25519','sign','1d'],capture_output=True,check=True)
                    self.assertEqual(publisher.publish([packages],catalog,output,'https://repo.example/native','DevOs Feed Test',['all'],str(indexer)),1)
                    for name in ('Packages','app-store.json'):
                        subprocess.run(['gpg','--batch','--verify',str(output/(name+'.asc')),str(output/name)],capture_output=True,check=True)
                    self.assertIn('Filename: example_1_all.ipk', (output/'Packages').read_text())
                    self.assertIn('option check_signature 1',(output/'app-store-opkg.conf').read_text())
                    with self.assertRaises(ValueError): publisher.publish([packages],catalog,output,'https://repo.example/native','DevOs Feed Test',['all'],str(indexer))
                finally:
                    if shutil.which('gpgconf'): subprocess.run(['gpgconf','--homedir',str(home),'--kill','gpg-agent'],capture_output=True)

if __name__=='__main__':unittest.main()
