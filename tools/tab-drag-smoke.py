#!/usr/bin/env python3
"""Drag real GTK tabs between windows in a private headless Wayland session."""
import os
import select
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from smoke import ROOT, wait_for

screens = ROOT / 'build/screenshots-tab-drag'
screens.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='dev-os-tab-drag-') as temporary:
    base = Path(temporary)
    runtime = base / 'runtime'; runtime.mkdir(mode=0o700)
    config = base / 'config'; config.mkdir()
    env = os.environ | {'XDG_RUNTIME_DIR': str(runtime), 'XDG_CONFIG_HOME': str(config),
        'WLR_HEADLESS_OUTPUTS': '1', 'GTK_USE_PORTAL': '0'}
    pointer = None
    with (screens / 'session.log').open('w') as log:
        session = subprocess.Popen([str(ROOT / 'bin/dev-os-session'), '--headless'], env=env,
            stdout=log, stderr=log, start_new_session=True)
        try:
            wait_for(lambda: 'Dev OS shell ready' in (screens / 'session.log').read_text())
            shell_env = None
            for process in Path('/proc').iterdir():
                if not process.name.isdecimal(): continue
                try:
                    command = (process / 'cmdline').read_bytes().split(b'\0')
                    values = (process / 'environ').read_bytes().split(b'\0')
                except OSError: continue
                if str(ROOT / 'dist/main.js').encode() in command and f'XDG_RUNTIME_DIR={runtime}'.encode() in values:
                    shell_env = dict(item.decode().split('=', 1) for item in values if b'=' in item); break
            assert shell_env, 'Private shell environment missing'
            env |= {'WAYLAND_DISPLAY': next(path.name for path in runtime.glob('wayland-*') if path.is_socket()),
                'DBUS_SESSION_BUS_ADDRESS': shell_env['DBUS_SESSION_BUS_ADDRESS'], 'GDK_BACKEND': 'wayland'}
            pointer = subprocess.Popen(['dev-os-test-pointer-session'], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            def pointer_command(*arguments):
                pointer.stdin.write(' '.join(map(str, arguments)) + '\n'); pointer.stdin.flush()
                assert select.select([pointer.stdout], [], [], 5)[0], 'Pointer command timed out'
                assert pointer.stdout.readline().strip() == 'ok'
            def position(x, y):
                pointer_command('move', -10000, -10000); pointer_command('move', x, y)
            def drag(x, y, end_x, end_y, cancel=False):
                position(x, y); pointer_command('down', 'left')
                pointer_command('move', 0, 30)
                pointer_command('move', end_x - x, end_y - y - 30)
                # GTK may begin DnD on this motion; send another native motion
                # after its asynchronous start_drag request reaches the compositor.
                pointer_command('move', 1, 0)
                time.sleep(.3)
                if cancel: subprocess.run(['wtype', '-s', '300', '-k', 'Escape', '-s', '200'], env=env, check=True)
                pointer_command('up', 'left'); time.sleep(.5)
            def windows():
                return subprocess.run(['dev-os-test-pointer', 'window', 'list'], env=env, capture_output=True, text=True, check=True).stdout
            def snapshot(name):
                subprocess.run(['grim', str(screens / (name + '.png'))], env=env, check=True)
            for command, label in [('files', 'Dev OS Files'), ('terminal', 'Dev OS Terminal')]:
                subprocess.run([str(ROOT / 'bin/dev-os-shell'), command], env=env, check=True)
                wait_for(lambda: windows().count(label) == 1); time.sleep(.5)
                title = next(line.split(': ', 1)[1] for line in windows().splitlines() if label in line)
                for action in ('maximize', 'focus'):
                    subprocess.run(['dev-os-test-pointer', 'window', action, 'title:' + title], env=env, check=True)
                time.sleep(.4)
                position(184, 16); pointer_command('click', 'left'); time.sleep(.6)
                snapshot(command + '-before')
                drag(240, 16, 900, 350)
                wait_for(lambda: windows().count(label) == 2)
                snapshot(command + '-detached')
                # labwc centers new windows in the 1280 x 684 work area.
                # Files = 960 x 652; Terminal = 880 x 592, including the titlebar.
                x, y = (230, 32) if command == 'files' else (270, 62)
                # Use the exposed left tab; the detached window's CSD shadow
                # overlaps the strip directly above its own bounds.
                drag(x, y, 100, 16)
                wait_for(lambda: windows().count(label) == 1)
                snapshot(command + '-merged')
                drag(240, 16, 900, 350, cancel=True)
                assert windows().count(label) == 1, 'Escape must not detach a tab'
                print(f'PASS: {label} real pointer detach, merge and Escape cancellation', flush=True)
                if command == 'terminal':
                    file_title = next(line.split(': ', 1)[1] for line in windows().splitlines() if 'Dev OS Files' in line)
                    subprocess.run(['dev-os-test-pointer', 'window', 'minimize', 'title:' + file_title], env=env, check=True)
                    position(1228, 16); pointer_command('click', 'left'); time.sleep(.4)
                    drag(440, 62, 1240, 400)
                    wait_for(lambda: windows().count(label) == 2)
                    snapshot('terminal-desktop-detach')
                    print('PASS: dropping outside all windows on the desktop detaches the tab', flush=True)
            text = (screens / 'session.log').read_text()
            assert 'JS ERROR' not in text and 'Gtk-CRITICAL' not in text and 'Gjs-CRITICAL' not in text, text
        except Exception:
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
