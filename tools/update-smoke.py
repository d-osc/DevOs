#!/usr/bin/env python3
"""Download the published GitHub release and start its real desktop privately."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def wait_for(predicate, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.1)
    raise RuntimeError('Timed out waiting for the updated desktop')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='Save report, session log and real screenshots')
    parser.add_argument('--switch', action='store_true', help='Switch from the source shell to the installed release on the same compositor')
    parser.add_argument('--package', type=Path, help='Use a local release artifact instead of GitHub (for testing before publication)')
    args = parser.parse_args()
    if sys.platform != 'linux':
        parser.error('Run inside Linux or WSL, after npm run build')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='dev-os-live-update-') as temporary:
        base = Path(temporary)
        runtime = base / 'runtime'
        runtime.mkdir(mode=0o700)
        config = base / 'config/dev-os/extensions'
        config.mkdir(parents=True)
        workspace = base / 'workspace'
        workspace.mkdir()
        (workspace / 'hello.ts').write_text('export const message = "Updated from GitHub Releases";\n')
        (config / 'org.devos.files.json').write_text(json.dumps({'version': 1, 'enabled': True, 'values': {'homeDirectory': str(workspace)}}))
        env = os.environ | {'XDG_DATA_HOME': str(base / 'data'), 'XDG_CONFIG_HOME': str(base / 'config'),
                            'XDG_RUNTIME_DIR': str(runtime), 'GTK_USE_PORTAL': '0', 'PYTHONUNBUFFERED': '1'}
        env.pop('DEV_OS_UPDATE_TEST_PACKAGE', None)
        if args.package:
            env['DEV_OS_UPDATE_TEST_PACKAGE'] = str(args.package.resolve())
        vte = ROOT / 'build/wsl/vte/usr/lib/x86_64-linux-gnu'
        if args.switch:
            # Match dev.ps1 run: the session launcher must prepare optional VTE.
            # Injecting it here previously masked loss at supervisor handoff.
            for key in ('GI_TYPELIB_PATH', 'LD_LIBRARY_PATH', 'DEV_OS_VTE_RUNTIME'):
                env.pop(key, None)
        elif vte.exists():
            env |= {'GI_TYPELIB_PATH': str(vte / 'girepository-1.0'), 'LD_LIBRARY_PATH': str(vte)}
        subprocess.run(['gjs', '-m', str(ROOT / 'dist/updates-live-test.js'), str(base)], env=env, check=True, timeout=360)
        report = json.loads((base / 'result.json').read_text())
        selection = json.loads((base / 'data/dev-os-updates/history.json').read_text())
        installed = base / 'data/dev-os-updates/releases' / selection['current']['key']
        launcher = ROOT / 'bin/dev-os-updated-session'
        doctor = subprocess.run(['sh', str(launcher), '--check'], env=env, capture_output=True, text=True, check=True, timeout=30)
        (output / 'doctor.log').write_text(doctor.stdout + doctor.stderr)
        print('PASS: downloaded release dependency doctor', flush=True)
        log = output / 'session.log'
        process = None
        shell_pid = None
        try:
            with log.open('w') as stream:
                initial = ROOT if args.switch else installed
                process = subprocess.Popen(['sh', str(ROOT / 'bin/dev-os-session' if args.switch else launcher), '--headless'], env=env, stdout=stream, stderr=stream, start_new_session=True)
                wait_for(lambda: 'Dev OS shell ready' in log.read_text())
                sockets = [path for path in runtime.glob('wayland-*') if path.is_socket()]
                assert len(sockets) == 1, sockets
                session_env = {}
                for entry in Path('/proc').iterdir():
                    if not entry.name.isdecimal():
                        continue
                    try:
                        command = (entry / 'cmdline').read_bytes().split(b'\0')
                        environ = (entry / 'environ').read_bytes().split(b'\0')
                    except (OSError, PermissionError):
                        continue
                    if str(initial / 'dist/main.js').encode() in command and f'XDG_RUNTIME_DIR={runtime}'.encode() in environ:
                        shell_pid = int(entry.name)
                        session_env = dict(item.decode().split('=', 1) for item in environ if b'=' in item)
                        break
                assert shell_pid is not None, 'Updated shell process was not found'
                if args.switch:
                    old_compositor = session_env['LABWC_PID']
                    request_env = env | {'DEV_OS_VERSION_REQUEST': session_env['DEV_OS_VERSION_REQUEST']}
                    rejected = subprocess.run(['gjs', '-m', str(ROOT / 'dist/version-request-test.js'), str(base / 'unselected')], env=request_env, capture_output=True, text=True, timeout=30)
                    assert rejected.returncode != 0 and not Path(session_env['DEV_OS_VERSION_REQUEST']).exists(), 'Invalid target must not create a restart request'
                    subprocess.run(['gjs', '-m', str(ROOT / 'dist/version-request-test.js'), str(installed)], env=request_env, check=True, timeout=60)
                    os.kill(shell_pid, signal.SIGTERM)
                    wait_for(lambda: log.read_text().count('Dev OS shell ready') >= 2)
                    shell_pid = None
                    for entry in Path('/proc').iterdir():
                        if not entry.name.isdecimal():
                            continue
                        try:
                            command = (entry / 'cmdline').read_bytes().split(b'\0')
                            environ = (entry / 'environ').read_bytes().split(b'\0')
                        except (OSError, PermissionError):
                            continue
                        if str(installed / 'dist/main.js').encode() in command and f'XDG_RUNTIME_DIR={runtime}'.encode() in environ:
                            assert shell_pid is None, 'Version switch started duplicate shells'
                            shell_pid = int(entry.name)
                            session_env = dict(item.decode().split('=', 1) for item in environ if b'=' in item)
                    assert shell_pid is not None, 'New shell did not start from the installed version'
                    assert session_env['LABWC_PID'] == old_compositor and sockets[0].is_socket(), 'Version switch restarted or closed the compositor'
                    assert log.read_text().count('Dev OS: switching session runtime') == 1, 'Supervisor must hand off exactly once'
                    report['version_switch'] = 'passed'
                    print('PASS: switch preflight, old shell exit, single runtime handoff and unchanged Wayland compositor', flush=True)
                assert session_env['DEV_OS_ROOT'] == str(installed), 'Session did not use the installed immutable release'
                actual = subprocess.run([str(installed / 'bin/dev-os-shell'), '--version'], env=env, check=True, capture_output=True, text=True, timeout=10).stdout.strip()
                assert actual == report['installed'], 'Running version does not match the installed package'
                report['running'] = actual
                child_env = env | {'WAYLAND_DISPLAY': sockets[0].name, 'GDK_BACKEND': 'wayland',
                                   'DBUS_SESSION_BUS_ADDRESS': session_env['DBUS_SESSION_BUS_ADDRESS']}

                def remote(command, *arguments):
                    subprocess.run([str(installed / 'bin/dev-os-shell'), command, *arguments], env=child_env, check=True, timeout=20)

                def screenshot(name):
                    time.sleep(.5)
                    subprocess.run(['grim', str(output / f'{name}.png')], env=child_env, check=True, timeout=10)

                screenshot('updated-desktop')
                remote('terminal')
                wait_for(lambda: 'Dev OS Terminal ready:' in log.read_text())
                screenshot('updated-terminal')
                report['terminal'] = 'passed'
                print('PASS: Terminal imports VTE and starts a real PTY after the runtime switch', flush=True)
                remote('files')
                wait_for(lambda: 'Dev OS Files ready' in log.read_text())
                screenshot('updated-files')
                remote('editor', str(workspace / 'hello.ts'))
                wait_for(lambda: 'Dev OS Editor' in subprocess.run(['wlrctl', 'toplevel', 'list'], env=child_env,
                         capture_output=True, text=True, check=True, timeout=5).stdout)
                time.sleep(2)
                screenshot('updated-editor')
                remote('settings')
                screenshot('updated-settings')
                assert not any(error in log.read_text() for error in ('JS ERROR', 'Gtk-CRITICAL', 'Gjs-CRITICAL')), log.read_text()
                print('PASS: downloaded immutable runtime starts Wayland, Files, Monaco Editor and Settings', flush=True)
                os.kill(shell_pid, signal.SIGTERM)
                process.wait(timeout=15)
                assert not any(path.is_socket() for path in runtime.glob('wayland-*')), 'Updated session did not clean up its compositor'
                print('PASS: updated session shuts down and removes its Wayland socket', flush=True)
                report |= {'wayland': 'passed', 'files': 'passed', 'editor': 'passed', 'settings': 'passed', 'cleanup': 'passed'}
                (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        finally:
            if process is not None and process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            fusermount = shutil.which('fusermount3') or shutil.which('fusermount')
            if fusermount:
                subprocess.run([fusermount, '-uz', str(runtime / 'doc')], capture_output=True, timeout=5)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
