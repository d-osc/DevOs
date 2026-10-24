#!/usr/bin/env python3
"""Verify camera dependencies, or apply them to a NEW private source copy.

Does not compile a kernel, enable a board sensor or change boot media.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(source):
    record = json.loads((HERE / 'series.json').read_text())
    for relative, expected in record['sourceFiles'].items():
        if digest(source / relative) != expected:
            raise ValueError('Wrong or modified pinned source: ' + relative)
    for patch in record['patches']:
        if digest(HERE / patch['file']) != patch['sha256']:
            raise ValueError('Camera patch checksum mismatch: ' + patch['file'])
        for relative in re.findall(r'^--- a/(.+)$', (HERE / patch['file']).read_text(), re.M):
            if relative not in record['sourceFiles']:
                raise ValueError('Unexpected patch target: ' + relative)
    return record


def apply(tree, record):
    for patch in record['patches']:
        subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '-p1', '-i', str(HERE / patch['file'])], cwd=tree, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, help='Optional NEW full source copy. Without this, only check temporary copies.')
    args = parser.parse_args()
    source = args.source.resolve()
    record = validate(source)
    with tempfile.TemporaryDirectory(prefix='devos-camera-check-') as directory:
        tree = Path(directory)
        for relative in record['sourceFiles']:
            target = tree / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / relative, target)
        apply(tree, record)
    if args.output:
        output = args.output.resolve()
        if output.exists() or output == source or source in output.parents:
            raise ValueError('Choose a new output directory outside the original source')
        shutil.copytree(source, output, symlinks=True)
        apply(output, record)
        (output / 'devos-camera-provenance.json').write_text(json.dumps(record, indent=2) + '\n')
    validate(source)  # The pinned original must remain unchanged.
    print(f'PASS: all {len(record["patches"])} camera dependency patches apply without fuzz; original source unchanged.')
    print('INCOMPLETE: UX3407NA board sensor/power/CSI graph and physical capture validation still required.')


if __name__ == '__main__':
    main()
