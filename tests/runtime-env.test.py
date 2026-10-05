"""Validate optional dependency paths before GJS starts and across handoffs."""
import os
from pathlib import Path
import subprocess
import tempfile

helper = Path(__file__).resolve().parents[1] / 'bin/dev-os-runtime-env'
with tempfile.TemporaryDirectory(prefix='dev-os-runtime-env-') as temporary:
    base = Path(temporary)
    source = base / 'source with spaces'
    library = source / 'build/wsl/vte/usr/lib/x86_64-linux-gnu'
    (library / 'girepository-1.0').mkdir(parents=True)
    (library / 'girepository-1.0/Vte-2.91.typelib').touch()
    tools = source / 'build/wsl/bin'
    tools.mkdir()
    target = base / 'installed'
    target.mkdir()

    def prepared(root, **extra):
        env = {'PATH': '/usr/bin:/bin'} | extra
        result = subprocess.run(['sh', '-c', 'root=$1; . "$2"; . "$2"; env', 'test', str(root), str(helper)],
                                env=env, check=True, text=True, capture_output=True)
        return dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)

    own = prepared(source, GI_TYPELIB_PATH='/other/types', LD_LIBRARY_PATH='/other/libs')
    assert own['DEV_OS_VTE_RUNTIME'] == str(library)
    assert own['GI_TYPELIB_PATH'] == f'{library}/girepository-1.0:/other/types'
    assert own['LD_LIBRARY_PATH'] == f'{library}:/other/libs'
    inherited = prepared(target, DEV_OS_VTE_RUNTIME=own['DEV_OS_VTE_RUNTIME'],
                         GI_TYPELIB_PATH=own['GI_TYPELIB_PATH'], LD_LIBRARY_PATH=own['LD_LIBRARY_PATH'])
    assert inherited['GI_TYPELIB_PATH'] == own['GI_TYPELIB_PATH']
    assert inherited['LD_LIBRARY_PATH'] == own['LD_LIBRARY_PATH']
    legacy = prepared(target, PATH=f'{tools}:/usr/bin:/bin')
    assert legacy['DEV_OS_VTE_RUNTIME'] == str(library)
    assert legacy['GI_TYPELIB_PATH'] == f'{library}/girepository-1.0'
    system = prepared(target)
    assert not any(key in system for key in ('DEV_OS_VTE_RUNTIME', 'GI_TYPELIB_PATH', 'LD_LIBRARY_PATH'))
print('PASS: supervisor runtime setup, inherited paths, legacy PATH recovery, spaces, deduplication and system dependencies')
