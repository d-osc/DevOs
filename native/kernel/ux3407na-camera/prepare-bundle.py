#!/usr/bin/env python3
"""Build matching camera modules and an explicit experimental A14 camera DTB.

Preserves the checked base kernel, EC module and audio fixes. Does not flash USB.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'build', 'bundle', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    series = json.loads((HERE / 'series.json').read_text())
    if json.loads((args.source / 'devos-camera-provenance.json').read_text()) != series:
        raise ValueError('Use a private source from prepare-source.py')
    for patch in series['patches']:
        if digest(HERE / patch['file']) != patch['sha256']:
            raise ValueError('Camera patch checksum mismatch')
    if args.output.exists():
        raise ValueError('Choose a new output bundle')
    record = json.loads((args.bundle / 'manifest.json').read_text())
    for name, expected in record['files'].items():
        if digest(args.bundle / name) != expected:
            raise ValueError('Base bundle checksum mismatch: ' + name)
    if (args.build / '.config').read_bytes() != (args.bundle / 'kernel.config').read_bytes():
        raise ValueError('Build configuration differs from the base kernel')
    ec = json.loads((args.bundle/'suspend-fixes.json').read_text())
    if ec['moduleSymversSha256'] != digest(args.build/'Module.symvers'):
        raise ValueError('Build symbol ABI differs from the checked base kernel')
    source = (args.build / 'source').resolve(strict=True)
    modules = {
        'drivers/media/platform/qcom/camss': ('qcom-camss', 'qcom,glymur-camss'),
        'drivers/mfd': ('qcom-pm8008', 'qcom,pm8010-i2c'),
        'drivers/regulator': ('qcom-pm8008-regulator', None),
    }
    modinfo = shutil.which('modinfo') or '/usr/sbin/modinfo'
    modprobe = shutil.which('modprobe') or '/usr/sbin/modprobe'
    symbols = {line.split()[1]: int(line.split()[0], 16)
               for line in (args.build/'Module.symvers').read_text().splitlines() if line.strip()}
    release = subprocess.check_output(['make', '-s', '-C', str(source), 'O='+str(args.build), 'kernelrelease'], text=True).strip()
    for directory, (name, alias) in modules.items():
        run('make', '-C', source, 'O='+str(args.build), 'ARCH=arm64', 'M='+str(args.source/directory), '-j2', 'modules')
        file = args.source / directory / (name + '.ko')
        magic = subprocess.check_output([modinfo, '-F', 'vermagic', str(file)], text=True)
        if magic.split()[0] != release:
            raise ValueError('Camera module version mismatch: ' + name)
        if alias and alias not in subprocess.check_output([modinfo, '-F', 'alias', str(file)], text=True):
            raise ValueError('Camera module lacks hardware match: ' + name)
        versions = subprocess.check_output([modprobe, '--show-modversions', str(file)], text=True)
        if not versions.strip():
            raise ValueError('Expected versioned module symbols: ' + name)
        for line in versions.splitlines():
            crc, symbol = line.split()
            if symbols.get(symbol) != int(crc, 16):
                raise ValueError('Base kernel symbol ABI mismatch: ' + name + ': ' + symbol)
    run(sys.executable, ROOT/'distro/usb/prepare-board-fixes.py', '--source', args.source,
        '--bundle', args.bundle, '--output', args.output, '--dtc', args.build/'scripts/dtc/dtc', '--enable-camera-candidate')
    patched = {}
    for directory, (name, _) in modules.items():
        targets = list((args.output/'modules/lib/modules'/release).rglob(name+'.ko'))
        if len(targets) != 1:
            raise ValueError('Expected exactly one base module: ' + name)
        shutil.copy2(args.source/directory/(name+'.ko'), targets[0])
        patched[str(targets[0].relative_to(args.output))] = digest(targets[0])
    run(shutil.which('depmod') or '/usr/sbin/depmod', '-b', args.output/'modules', release)
    (args.output/'camera-fixes.json').write_text(json.dumps({
        'patches': series['patches'], 'moduleSymversSha256': digest(args.build/'Module.symvers'),
        'kernelRelease': release, 'hardwareTested': False,
        'patchedModules': patched,
        'cameraWiring': 'community UX3407NA candidate; requires physical validation',
    }, indent=2)+'\n')
    record = json.loads((args.output/'manifest.json').read_text())
    record['files'] = {str(p.relative_to(args.output)): digest(p) for p in sorted(args.output.rglob('*'))
                       if p.is_file() and not p.is_symlink() and p.name != 'manifest.json'}
    record['hardwareTested'] = False
    (args.output/'manifest.json').write_text(json.dumps(record, indent=2)+'\n')
    print('PASS: matching camera modules + candidate DTB; EC/audio preserved: ' + str(args.output))
    print('Physical camera preview/capture remains unverified. No USB was written.')

if __name__ == '__main__':
    main()
