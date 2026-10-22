"""Run the real DevLang source runtime from Linux integration tests."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
D = os.environ.get('DEVLANG_BIN') or shutil.which('d')
if not D:
    raise RuntimeError('Install DevLang d (v0.5.5+) before running these tests.')

def run_source(source, *, env=None, ffi=False):
    with tempfile.TemporaryDirectory(prefix='devos-devlang-') as directory:
        entry = Path(directory) / 'test.dev'
        entry.write_text(source, encoding='utf-8')
        argv = [D, str(entry)]
        if ffi:
            for base in (Path('/usr/lib'), Path('/lib'), Path('/usr/lib64')):
                libraries = [base / 'libgio-2.0.so.0', *base.glob('*/libgio-2.0.so.0')]
                found = next((item for item in libraries if item.is_file()), None)
                if found:
                    argv += ['--ffi-lib', str(found)]
                    break
            else:
                raise RuntimeError('GIO is required for the NetworkManager integration tests.')
        if os.environ.get('DEVLANG_ENGINE'):
            argv += ['--engine', os.environ['DEVLANG_ENGINE']]
        result = subprocess.run(argv, capture_output=True, text=True, env=os.environ | (env or {}), timeout=45)
        assert result.returncode == 0, result.stdout + result.stderr
        return result.stdout

def use(name, alias=None):
    return f'use {json.dumps(str(ROOT / "lib" / (name + ".dev")))} as {alias or name}\n'

def run_bin(name, request, *, env=None, root=ROOT, args=()):
    argv = [D, str(root / 'bin' / ('dev-os-' + name))]
    if os.environ.get('DEVLANG_ENGINE'):
        argv += ['--engine', os.environ['DEVLANG_ENGINE']]
    if args:
        argv += ['--', *args]
    return subprocess.run(argv, input=json.dumps(request) + '\n', capture_output=True, text=True,
                          env=os.environ | (env or {}), timeout=45)
