"""Validate launcher images through Linux GIO and GdkPixbuf (requires python3-gi)."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import gi
gi.require_version('GdkPixbuf', '2.0')
from gi.repository import Gio, GdkPixbuf

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as scratch:
    base = Path(scratch)
    env = dict(os.environ, HOME=str(base), XDG_DATA_HOME=str(base / 'data'),
               DEV_ROOT=str(base / 'store'), DEV_BIN_DIR=str(base / 'bin'))
    for custom in (False, True):
        source = base / ('custom' if custom else 'fallback')
        source.mkdir()
        name = source.name
        (source / 'package.json').write_text(json.dumps({
            'name': name, 'version': '1', 'bin': {name: 'app'},
        }))
        executable = source / 'app'
        executable.write_text('#!/bin/sh\nexit 0\n')
        executable.chmod(0o755)
        if custom:
            (source / f'{name}.svg').write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">'
                '<rect width="32" height="32" fill="blue"/></svg>')
        archive = base / f'{name}.dpk'
        subprocess.run([binary, 'pack', str(source), '-o', str(archive)], env=env, check=True)
        subprocess.run([binary, 'install', str(archive)], env=env, check=True)
        desktop = base / f'data/applications/dev-{name}.desktop'
        app = Gio.DesktopAppInfo.new_from_filename(str(desktop))
        assert app and app.should_show(), desktop
        icon = app.get_icon()
        assert isinstance(icon, Gio.FileIcon), icon
        path = icon.get_file().get_path()
        pixbuf = GdkPixbuf.Pixbuf.new_from_file(path)
        assert pixbuf.get_width() > 0 and pixbuf.get_height() > 0
        print(f'{name}: GIO reads launcher and decodes icon ({pixbuf.get_width()}px)')
