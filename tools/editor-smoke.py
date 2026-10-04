#!/usr/bin/env python3
"""Exercise native Editor file arguments, Monaco keyboard input and real tab dragging."""
import os
import select
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from PIL import Image
from smoke import ROOT, wait_for

screens = ROOT / 'build/screenshots-editor-focused'
screens.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='dev-os-editor-smoke-') as temporary:
    base = Path(temporary)
    runtime = base / 'runtime'; runtime.mkdir(mode=0o700)
    config = base / 'config'; config.mkdir()
    first = base / 'first file.ts'; first.write_text('export const first = 1;\n')
    second = base / 'second.ts'; second.write_text('export const second = 2;\n')
    env = os.environ | {'XDG_RUNTIME_DIR': str(runtime), 'XDG_CONFIG_HOME': str(config),
        'XDG_DATA_HOME': str(base / 'data'), 'GTK_USE_PORTAL': '0'}
    pointer = None
    with (screens / 'session.log').open('w') as log:
        session = subprocess.Popen([str(ROOT / 'bin/dev-os-session'), '--headless'], env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            def started():
                if session.poll() is not None:
                    raise RuntimeError((screens / 'session.log').read_text())
                return 'Dev OS shell ready' in (screens / 'session.log').read_text()
            wait_for(started, timeout=90)
            for process in Path('/proc').iterdir():
                if not process.name.isdecimal(): continue
                try:
                    values = (process / 'environ').read_bytes().split(b'\0')
                    if str(ROOT / 'dist/main.js').encode() in (process / 'cmdline').read_bytes().split(b'\0') and f'XDG_RUNTIME_DIR={runtime}'.encode() in values:
                        env['DBUS_SESSION_BUS_ADDRESS'] = next(value.decode().split('=', 1)[1] for value in values if value.startswith(b'DBUS_SESSION_BUS_ADDRESS='))
                except OSError: pass
            env |= {'WAYLAND_DISPLAY': next(path.name for path in runtime.glob('wayland-*') if path.is_socket()), 'GDK_BACKEND': 'wayland'}
            pointer = subprocess.Popen(['dev-os-test-pointer-session'], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            def point(*args):
                pointer.stdin.write(' '.join(map(str, args)) + '\n'); pointer.stdin.flush()
                assert select.select([pointer.stdout], [], [], 5)[0]
                assert pointer.stdout.readline().strip() == 'ok'
            def position(x, y):
                point('move', -10000, -10000); point('move', x, y)
            def keys(*args):
                subprocess.run(['wtype', *args], env=env, check=True)
            def windows():
                return subprocess.run(['dev-os-test-pointer', 'window', 'list'], env=env, capture_output=True, text=True, check=True).stdout
            def window(action, title):
                subprocess.run(['dev-os-test-pointer', 'window', action, 'title:' + title], env=env, check=True)
            def snapshot(name):
                subprocess.run(['grim', str(screens / (name + '.png'))], env=env, check=True)
            def drag(x, y, end_x, end_y, cancel=False):
                position(x, y); point('down', 'left'); time.sleep(.1)
                point('move', 0, 30); time.sleep(.2)
                point('move', end_x - x, end_y - y - 30); point('move', 1, 0); time.sleep(.3)
                if cancel: keys('-s', '250', '-k', 'Escape', '-s', '200')
                point('up', 'left'); time.sleep(.5)
            subprocess.run([str(ROOT / 'bin/dev-os-editor'), str(first), str(second)], env=env, check=True)
            wait_for(lambda: 'Dev OS Editor · second.ts' in windows())
            title = next(line.split(': ', 1)[1] for line in windows().splitlines() if 'second.ts' in line)
            def rendered():
                snapshot('editor')
                # The window is mapped before WebKit finishes loading. Only inspect
                # the editing area, excluding native toolbar and status text.
                picture = Image.open(screens / 'editor.png').convert('RGB').crop((125, 90, 1100, 600))
                return sum(max(pixel) > 120 for pixel in picture.getdata()) > 80
            wait_for(rendered, timeout=30); time.sleep(1)
            window('maximize', title); window('focus', title); time.sleep(.5)
            position(400, 140); point('click', 'left')
            keys('-M', 'ctrl', '-k', 'a', '-m', 'ctrl')
            keys('-d', '15', 'export const saved = 42;')
            keys('-M', 'ctrl', '-k', 's', '-m', 'ctrl')
            wait_for(lambda: second.read_text().strip() == 'export const saved = 42;')
            assert first.read_text() == 'export const first = 1;\n', 'Saving one tab must not change another file'
            snapshot('editor-saved')
            drag(240, 16, 900, 350)
            wait_for(lambda: windows().count('Dev OS Editor') == 2)
            snapshot('editor-detached')
            drag(190, 32, 100, 16)
            wait_for(lambda: windows().count('Dev OS Editor') == 1)
            snapshot('editor-merged')
            drag(240, 16, 900, 350, cancel=True)
            assert windows().count('Dev OS Editor') == 1, 'Esc cancels the drag'
            print('PASS: Editor multi-file command, real Monaco typing/save, pointer detach/merge and Escape', flush=True)
            text = (screens / 'session.log').read_text()
            assert not any(marker in text for marker in ('JS ERROR', 'Gtk-CRITICAL', 'Gjs-CRITICAL')), text
        except Exception:
            print(f'File after keyboard save: {second.read_text()!r}', flush=True)
            if pointer: subprocess.run(['grim', str(screens / 'failure.png')], env=env, capture_output=True)
            raise
        finally:
            if pointer:
                pointer.stdin.close()
                try: pointer.wait(timeout=3)
                except subprocess.TimeoutExpired: pointer.kill(); pointer.wait()
            if session.poll() is None:
                os.killpg(session.pid, signal.SIGTERM)
                try: session.wait(timeout=5)
                except subprocess.TimeoutExpired: os.killpg(session.pid, signal.SIGKILL); session.wait()
            fusermount = shutil.which('fusermount3') or shutil.which('fusermount')
            if fusermount: subprocess.run([fusermount, '-uz', str(runtime / 'doc')], capture_output=True, timeout=5)
