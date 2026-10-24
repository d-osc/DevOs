#!/usr/bin/env python3
"""Add the upstream ASUS EC module and board nodes to a matching private X2 bundle."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from board_audio import append_audio, write_proof

PATCHES = {
    '0001-asus-glymur-ec.patch': '19c769edb764d3b6d9358eef9b39baed9b4e839d1b20a65e9e7923a5bfc7e5e4',
    '0002-ux3407na-ec.patch': 'e8110cf1d5fa3aad9c17f914da0c951142da463cffdc7718dbeb03fc6982fc83',
}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'build', 'bundle', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    patches = Path(__file__).resolve().parents[2] / 'native/kernel/asus-glymur-ec'
    for name, expected in PATCHES.items():
        if digest(patches / name) != expected:
            raise ValueError('Upstream patch checksum mismatch: ' + name)
    record = json.loads((args.bundle / 'manifest.json').read_text())
    for name, expected in record['files'].items():
        if digest(args.bundle / name) != expected:
            raise ValueError('Input bundle checksum mismatch: ' + name)
    # Out-of-tree module builds must use precisely the Image, config and symbol
    # versions that produced this bundle, never the build host's kernel headers.
    for built, bundled in (('arch/arm64/boot/Image', 'Image'), ('.config', 'kernel.config')):
        if digest(args.build / built) != digest(args.bundle / bundled):
            raise ValueError('Kernel build differs from input bundle: ' + built)
    release = record['release']
    if (args.build / 'include/config/kernel.release').read_text().strip() != release:
        raise ValueError('Kernel release mismatch')
    config = (args.build / '.config').read_text().splitlines()
    for setting in ('PM', 'I2C', 'HWMON', 'INPUT', 'LEDS_CLASS'):
        if 'CONFIG_' + setting + '=y' not in config:
            raise ValueError('Required built-in kernel dependency missing: ' + setting)
    if args.output.exists():
        raise ValueError('Choose a new output bundle')
    with tempfile.TemporaryDirectory(prefix='devos-asus-ec-') as temporary:
        tree = Path(temporary)
        module = tree / 'module'
        module.mkdir()
        lines = (patches / '0001-asus-glymur-ec.patch').read_text().splitlines()
        start = lines.index('@@ -0,0 +1,616 @@') + 1
        additions = lines[start:start + 616]
        if len(additions) != 616 or any(not line.startswith('+') for line in additions):
            raise ValueError('Unexpected upstream module patch format')
        (module / 'asus-glymur-ec.c').write_text('\n'.join(line[1:] for line in additions) + '\n')
        (module / 'Makefile').write_text('obj-m += asus-glymur-ec.o\n')
        run('make', '-C', args.source, 'O=' + str(args.build), 'ARCH=arm64',
            'M=' + str(module), '-j2', 'modules')
        vermagic = subprocess.check_output(['modinfo', '-F', 'vermagic', str(module / 'asus-glymur-ec.ko')], text=True)
        aliases = subprocess.check_output(['modinfo', '-F', 'alias', str(module / 'asus-glymur-ec.ko')], text=True)
        if vermagic.split()[0] != release or 'asus,zenbook-a14-ux3407na-ec' not in aliases:
            raise ValueError('Module version or device alias mismatch')
        relative = Path('arch/arm64/boot/dts/qcom/glymur-asus-zenbook-a14-ux3407na.dts')
        board = tree / relative
        board.parent.mkdir(parents=True)
        shutil.copy2(args.source / relative, board)
        run('patch', '--batch', '--fuzz=0', '-p1', '-i', patches / '0002-ux3407na-ec.patch', cwd=tree)
        # Sleep and audio corrections must share one DTB. Rebuilding from the
        # pinned source previously brought back the incompatible four-speaker map.
        append_audio(board)
        expanded = tree / 'board.pp.dts'
        with expanded.open('wb') as stream:
            run('gcc', '-E', '-nostdinc', '-undef', '-D__DTS__', '-x', 'assembler-with-cpp',
                '-I' + str(args.source / 'include'), '-I' + str((args.source / relative).parent), board, stdout=stream)
        dtb = tree / 'board.dtb'
        run(args.build / 'scripts/dtc/dtc', '-I', 'dts', '-O', 'dtb', '-o', dtb, expanded,
            stderr=subprocess.PIPE)
        shutil.copytree(args.bundle, args.output, symlinks=True)
        shutil.copy2(dtb, args.output / 'board.dtb')
        module_root = args.output / 'modules/lib/modules' / release
        target = module_root / 'extra'
        target.mkdir(exist_ok=True)
        shutil.copy2(module / 'asus-glymur-ec.ko', target)
        run('depmod', '-b', args.output / 'modules', release)
    proof = {'patches': PATCHES, 'upstream': 'https://lists.openwall.net/linux-kernel/2026/10/15/948',
             'hardwareTested': False, 'moduleVermagic': vermagic.strip(),
             'moduleSymversSha256': digest(args.build / 'Module.symvers')}
    (args.output / 'suspend-fixes.json').write_text(json.dumps(proof, indent=2) + '\n')
    write_proof(args.output, args.source / relative)
    record['files'] = {str(path.relative_to(args.output)): digest(path)
                       for path in sorted(args.output.rglob('*'))
                       if path.is_file() and not path.is_symlink() and path.name != 'manifest.json'}
    record['hardwareTested'] = False
    (args.output / 'manifest.json').write_text(json.dumps(record, indent=2) + '\n')
    print('Prepared matching ASUS EC module and UX3407NA wakeup DTB: ' + str(args.output))


if __name__ == '__main__':
    main()
