#!/usr/bin/env python3
"""Measure shell startup, remote commands and React/GTK updates on headless Wayland."""
import argparse
import json
import os
from pathlib import Path
import signal
import shutil
import statistics
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]


def wait_for(predicate, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(.01)
    raise RuntimeError("Timed out waiting for headless shell")


def main():
    global ROOT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT, help='Use a staged runtime on the Linux filesystem')
    ROOT = parser.parse_args().root.resolve()
    with tempfile.TemporaryDirectory(prefix="dev-os-performance-") as directory:
        base = Path(directory)
        runtime = base / "runtime"
        runtime.mkdir(mode=0o700)
        config = base / "config/dev-os"
        (config / "extensions").mkdir(parents=True)
        (config / "config.json").write_text('{"autostart":[]}\n')
        (config / "extensions/org.devos.files.json").write_text(json.dumps({
            "version": 1, "enabled": True, "values": {"homeDirectory": str(base)}}))
        env = os.environ | {"XDG_RUNTIME_DIR": str(runtime), "XDG_CONFIG_HOME": str(config.parent),
                           "GTK_USE_PORTAL": "0", "WLR_HEADLESS_OUTPUTS": "1"}
        log = base / "session.log"
        with log.open("w") as output:
            start = time.monotonic()
            process = subprocess.Popen(["sh", str(ROOT / "bin/dev-os-session"), "--headless"],
                                       env=env, stdout=output, stderr=output, start_new_session=True)
            try:
                def started():
                    if process.poll() is not None:
                        raise RuntimeError(log.read_text())
                    return "Dev OS shell ready" in log.read_text()
                wait_for(started)
                startup = (time.monotonic() - start) * 1000

                def find_environment():
                    for entry in Path('/proc').iterdir():
                        if not entry.name.isdecimal():
                            continue
                        try:
                            args = (entry / 'cmdline').read_bytes().split(b'\0')
                            variables = (entry / 'environ').read_bytes().split(b'\0')
                        except OSError:
                            continue
                        if (str(ROOT / 'dist/main.js').encode() in args
                                and f'XDG_RUNTIME_DIR={runtime}'.encode() in variables):
                            return dict(value.decode().split('=', 1) for value in variables if b'=' in value)
                    return None

                child_env = wait_for(find_environment)
                result = subprocess.run(['gjs', '-m', str(ROOT / 'dist/performance-test.js')],
                                        env=child_env, text=True, capture_output=True, check=True, timeout=60)
                report = json.loads(result.stdout.strip().splitlines()[-1])
                report['headless_session_startup_ms'] = startup
                for command, samples in [('shell', 8), ('launcher', 8), ('files', 3)]:
                    elapsed = []
                    for _ in range(samples):
                        start = time.monotonic()
                        result = subprocess.run(['sh', str(ROOT / 'bin/dev-os-shell'), command],
                                                env=child_env, text=True, capture_output=True, check=True, timeout=15)
                        elapsed.append((time.monotonic() - start) * 1000)
                    report[f'{command}_command_median_ms'] = statistics.median(elapsed)
                print(json.dumps(report, indent=2), flush=True)
            except Exception:
                print(log.read_text(), flush=True)
                raise
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                # A session portal can leave its document FUSE mount behind
                # after D-Bus stops. Unmount only this benchmark's private path.
                unmount = shutil.which('fusermount3') or shutil.which('fusermount')
                if unmount:
                    subprocess.run([unmount, '-uz', str(runtime / 'doc')],
                                   capture_output=True, timeout=5, check=False)


if __name__ == '__main__':
    main()
