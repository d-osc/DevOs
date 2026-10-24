"""Validate a built camera candidate. Set DEVOS_CAMERA_BUNDLE to its path."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'distro/usb'))
import board_audio

@unittest.skipUnless(os.getenv('DEVOS_CAMERA_BUNDLE'), 'requires built camera bundle')
class CameraBundleTests(unittest.TestCase):
    def test_modules_dtb_and_preserved_fixes(self):
        bundle=Path(os.environ['DEVOS_CAMERA_BUNDLE'])
        manifest=json.loads((bundle/'manifest.json').read_text())
        board_audio.validate_proof(bundle, manifest)
        for name, digest in manifest['files'].items():
            self.assertEqual(hashlib.sha256((bundle/name).read_bytes()).hexdigest(),digest,name)
        self.assertIn('suspend-fixes.json',manifest['files'])
        self.assertIn('camera-fixes.json',manifest['files'])
        board=json.loads((bundle/'board-fixes.json').read_text())
        self.assertEqual(board['audioLayout'],'two-speakers-two-dmics')
        self.assertIn('cameraCandidateSha256',board)
        modules=bundle/'modules/lib/modules'/json.loads((bundle/'camera-fixes.json').read_text())['kernelRelease']
        for name, alias in [('qcom-camss','qcom,glymur-camss'),('qcom-pm8008','qcom,pm8010-i2c')]:
            files=list(modules.rglob(name+'.ko')); self.assertEqual(len(files),1)
            self.assertIn(alias,subprocess.check_output(['/usr/sbin/modinfo','-F','alias',str(files[0])],text=True))
        self.assertTrue(list(modules.rglob('asus-glymur-ec.ko')))
        dtc=os.environ['DEVOS_DTC']
        tree=subprocess.check_output([dtc,'-I','dtb','-O','dts',str(bundle/'board.dtb')],stderr=subprocess.DEVNULL,text=True)
        for item in ['ovti,ov02c10','qcom,glymur-camss','qcom,pm8010-i2c','asus,zenbook-a14-ux3407na-ec']:
            self.assertIn(item,tree)
        self.assertIn('phy-names = "csiphy0", "csiphy1", "csiphy4";',tree)
        proof=json.loads((bundle/'camera-fixes.json').read_text())
        self.assertIn('0002-camss-glymur-phy-resources.patch',[item['file'] for item in proof['patches']])
        self.assertFalse(manifest['hardwareTested'])

if __name__=='__main__': unittest.main()
