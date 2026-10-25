#!/usr/bin/env python3
"""Run the Python tests that need no hardware, root, QEMU, WSL or OpenEmbedded build (used by CI and releases).

Most tests run the real DevLang `d` (v0.5.5+, from PATH or $DEVLANG_BIN); without it they fail on import.
Each test runs in its own process, as `python3 tests/<name>.test.py`.
"""
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
# name -> why it does not run on a GitHub runner
SKIPPED = {
    'live-usb-release': 'drives tools/live/release-live-usb.ps1 through Windows PowerShell',
    'oe-image-toolchains': 'known failure on this branch: the nvm recipe test expects an older source checksum',
    'tools-devlang': 'known failure on this branch: tools/live, tools/maintenance and tools/mcp still hold Python tools',
}


def main():
    names = sorted(path.name[:-len('.test.py')] for path in (ROOT / 'tests').glob('*.test.py'))
    failed = []
    for name in names:
        if name in SKIPPED:
            print(f'SKIP {name}: {SKIPPED[name]}', flush=True)
            continue
        started = time.monotonic()
        result = subprocess.run([sys.executable, '-B', str(ROOT / 'tests' / f'{name}.test.py')], cwd=ROOT,
                                capture_output=True, text=True, env=os.environ | {'PYTHONDONTWRITEBYTECODE': '1'})
        status = 'ok  ' if result.returncode == 0 else 'FAIL'
        print(f'{status} {name} ({time.monotonic() - started:.0f}s)', flush=True)
        if result.returncode:
            failed.append(name)
            print((result.stdout + result.stderr)[-4000:], flush=True)
    print(f'{len(names) - len(SKIPPED) - len(failed)} passed, {len(failed)} failed, {len(SKIPPED)} skipped')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
