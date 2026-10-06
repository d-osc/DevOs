#!/usr/bin/env python3
"""Test native session locking in a disposable headless session (never the user's desktop)."""
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from smoke_support import cleanup_session

ROOT = Path(__file__).resolve().parents[2]


def wait_for(predicate):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.1)
    raise AssertionError("Timed out waiting for lock/session state")


def processes(runtime, executable):
    result = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            args = (entry / 'cmdline').read_bytes().split(b'\0')
            environment = (entry / 'environ').read_bytes().split(b'\0')
            if (f'XDG_RUNTIME_DIR={runtime}'.encode() in environment
                    and any(Path(arg.decode()).name == executable for arg in args if arg)):
                result.append((int(entry.name), dict(item.decode().split('=', 1)
                                                     for item in environment if b'=' in item)))
        except (OSError, UnicodeError):
            pass
    # swaylock forks a PAM worker; count only top-level locker processes.
    ids = {pid for pid, _env in result}
    return [(pid, env) for pid, env in result
            if int((Path('/proc') / str(pid) / 'stat').read_text().split(') ', 1)[1].split()[1]) not in ids]


def main():
    with tempfile.TemporaryDirectory(prefix='dev-os-lock-smoke-') as temporary:
        base = Path(temporary)
        runtime = base / 'runtime'
        runtime.mkdir(mode=0o700)
        env = os.environ | {'XDG_RUNTIME_DIR': str(runtime), 'XDG_CONFIG_HOME': str(base / 'config'),
                            'XDG_DATA_HOME': str(base / 'data'), 'WLR_HEADLESS_OUTPUTS': '2',
                            'GTK_USE_PORTAL': '0'}
        log = base / 'session.log'
        with log.open('w') as output:
            session = subprocess.Popen(['sh', str(ROOT / 'bin/dev-os-session'), '--headless'],
                                       env=env, stdout=output, stderr=output, start_new_session=True)
            try:
                wait_for(lambda: 'Dev OS shell ready' in log.read_text())
                shells = processes(runtime, 'main.js')
                assert len(shells) == 1, shells
                shell_pid, shell_env = shells[0]
                client = env | {key: shell_env[key] for key in ('DBUS_SESSION_BUS_ADDRESS',
                                      'GI_TYPELIB_PATH', 'LD_LIBRARY_PATH') if key in shell_env}
                client['WAYLAND_DISPLAY'] = next(path.name for path in runtime.glob('wayland-*') if path.is_socket())

                def command(name):
                    subprocess.run(['sh', str(ROOT / 'bin/dev-os-shell'), name], env=client,
                                   check=True, timeout=10)

                command('lock')
                wait_for(lambda: bool(processes(runtime, 'swaylock')))
                time.sleep(1)
                lockers = processes(runtime, 'swaylock')
                assert len(lockers) == 1
                command('lock')
                assert len(processes(runtime, 'swaylock')) == 1, 'Duplicate locker'
                destination = ROOT / 'build/test-results/lock-screen.png'
                destination.parent.mkdir(parents=True, exist_ok=True)
                subprocess.run(['grim', '-o', 'HEADLESS-1', str(destination)], env=client,
                               check=True, timeout=10)
                subprocess.run(['grim', '-o', 'HEADLESS-2', str(destination.with_name('lock-screen-2.png'))],
                               env=client, check=True, timeout=10)
                print('PASS: native compositor lock on two outputs; duplicate requests reuse locker', flush=True)
                # Official swaylock test recovery signal, scoped to this disposable session only.
                os.kill(lockers[0][0], signal.SIGUSR1)
                wait_for(lambda: not processes(runtime, 'swaylock'))
                time.sleep(.3)
                subprocess.run(['wtype', '-M', 'logo', '-k', 'l', '-m', 'logo'],
                               env=client, check=True, timeout=10)
                wait_for(lambda: bool(processes(runtime, 'swaylock')))
                time.sleep(1)
                lockers = processes(runtime, 'swaylock')
                os.kill(shell_pid, signal.SIGSTOP)
                time.sleep(.3)
                assert processes(runtime, 'swaylock'), 'Locker must run independently of shell responsiveness'
                os.kill(lockers[0][0], signal.SIGUSR1)
                wait_for(lambda: not processes(runtime, 'swaylock'))
                os.kill(shell_pid, signal.SIGCONT)
                assert 'JS ERROR' not in log.read_text(), log.read_text()
                print('PASS: unlock/Super+L relock; locker remains active while shell is suspended', flush=True)
            except Exception:
                print(log.read_text(), flush=True)
                raise
            finally:
                cleanup_session(session, None, runtime / 'doc')


if __name__ == '__main__':
    main()
