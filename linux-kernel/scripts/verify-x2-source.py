import hashlib
import json
from pathlib import Path
import sys
import tarfile

def digest(path):
    with path.open('rb') as stream: return hashlib.file_digest(stream,'sha256').hexdigest()

if sys.argv[1]=='--manifest':
    bundle=Path(sys.argv[2]);release=sys.argv[3];archive=Path(sys.argv[4])
    files={str(p.relative_to(bundle)):digest(p) for p in sorted(bundle.rglob('*')) if p.is_file() and not p.is_symlink() and p.name!='manifest.json'}
    (bundle/'manifest.json').write_text(json.dumps({'schemaVersion':1,'board':'asus-ux3407na','architecture':'aarch64',
        'release':release,'hardwareTested':False,'source':{'url':sys.argv[5],'sha256':digest(archive),'kind':'Linux source with Ubuntu Concept Qualcomm patches; no Ubuntu userspace'},'files':files},indent=2)+'\n')
else:
    source=Path(sys.argv[2]);checked=0
    with tarfile.open(sys.argv[1]) as archive:
        for item in archive:
            if not item.isfile(): continue
            relative=Path(*Path(item.name).parts[1:])
            if relative.is_absolute() or '..' in relative.parts: raise ValueError('Unsafe source archive path')
            path=source/relative
            with archive.extractfile(item) as stream: expected=hashlib.file_digest(stream,'sha256').hexdigest()
            if not path.is_file() or digest(path)!=expected: raise ValueError(f'Cached source differs from archive: {path}')
            checked+=1
    print(f'Verified {checked} source files against the pinned archive',flush=True)
