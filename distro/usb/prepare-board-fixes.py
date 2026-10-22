#!/usr/bin/env python3
"""Compile a private UX3407NA DTB with upstream audio nodes; no kernel source edits."""
import argparse,hashlib,json,os,shutil,subprocess,tempfile
from pathlib import Path

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True);parser.add_argument('--bundle',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--dtc',required=True);args=parser.parse_args()
 if not Path(args.dtc).is_file():raise ValueError('Missing built Device Tree compiler')
 if args.output.exists():raise ValueError('Choose a new output bundle')
 config=Path(__file__).with_name('ux3407na-audio.dtsi')
 original=args.source/'arch/arm64/boot/dts/qcom/glymur-asus-zenbook-a14-ux3407na.dts'
 assert 'asus,zenbook-a14-ux3407na' in original.read_text()
 record=json.loads((args.bundle/'manifest.json').read_text())
 for name,expected in record['files'].items():
  if digest(args.bundle/name)!=expected:raise ValueError('Input kernel bundle checksum mismatch: '+name)
 shutil.copytree(args.bundle,args.output,copy_function=shutil.copy2,symlinks=True)
 target=args.output/'board.dtb';target.unlink()
 with tempfile.TemporaryDirectory(prefix='devos-dtb-') as tmp:
  tmp=Path(tmp);source=tmp/'board.dts';expanded=tmp/'board.pp.dts'
  source.write_text(original.read_text()+'\n'+config.read_text())
  with expanded.open('wb') as stream:
   subprocess.run(['gcc','-E','-nostdinc','-undef','-D__DTS__','-x','assembler-with-cpp','-I'+str(args.source/'include'),'-I'+str(original.parent),str(source)],stdout=stream,check=True)
  subprocess.run([args.dtc,'-I','dts','-O','dtb','-o',str(target),str(expanded)],check=True)
 proof=args.output/'board-fixes.json'
 proof.write_text(json.dumps({'baseDtsSha256':digest(original),'overrideSha256':digest(config),'upstreamAudio':'https://patchew.org/linux/20260915-zenbook-dts-v2-0-41de8669a7a8@oss.qualcomm.com/','bluetoothFirmware':['qca/ornnv11.bin','qca/ornbtfw11.tlv'],'hardwareTested':False},indent=2)+'\n')
 record['files']['board.dtb']=digest(target);record['files']['board-fixes.json']=digest(proof)
 record['hardwareTested']=False
 manifest=args.output/'manifest.json';manifest.unlink();manifest.write_text(json.dumps(record,indent=2)+'\n')
 print('Prepared private board DTB with two-speaker routing and explicit QCC2072 Bluetooth firmware: '+str(args.output))
if __name__=='__main__':main()
