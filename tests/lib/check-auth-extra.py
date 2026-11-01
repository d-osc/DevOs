"""PTY authentication against a temporary account store; no system account edits."""
import fcntl
import os
from pathlib import Path
import pty
import pwd
import select
import signal
import subprocess
import sys
import tempfile
import termios
import time

binary = str(Path(sys.argv[1]).resolve())
name = pwd.getpwuid(os.getuid()).pw_name


def attach():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


def read_until(master, pattern, timeout=5):
    output = bytearray()
    deadline = time.monotonic() + timeout
    while pattern not in output and time.monotonic() < deadline:
        if select.select([master], [], [], .05)[0]:
            output.extend(os.read(master, 4096))
    assert pattern in output, (pattern, output)
    return output


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    env = {**os.environ, "BUSYBOX_ETC": str(root)}
    hashed = subprocess.check_output([binary, "cryptpw", "-m", "sha512", "-S", "test-salt", "test-secret"], timeout=8).decode().strip()
    (root / "passwd").write_text(f"{name}:x:{os.getuid()}:{os.getgid()}::/:/bin/sh\n" + ("root:x:0:0::/:/bin/sh\n" if name != "root" else ""))
    (root / "shadow").write_text(f"{name}:{hashed}:0:0:99999:7:::\n" + ("root:!:0:0:99999:7:::\n" if name != "root" else ""))
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    process = subprocess.Popen([binary, "vlock"], stdin=slave, stdout=slave, stderr=slave,
                               env=env, preexec_fn=attach)
    try:
        read_until(master, b"Password: ")
        assert not termios.tcgetattr(slave)[3] & termios.ECHO
        os.write(master, b"\x04")
        read_until(master, b"Password: ")
        assert process.poll() is None, "EOF must not bypass the lock"
        process.send_signal(signal.SIGTERM)
        time.sleep(.1)
        assert process.poll() is None, "SIGTERM must not bypass the lock"
        os.write(master, b"wrong-password\n")
        output = read_until(master, b"Password: ")
        assert b"wrong-password" not in output
        assert process.poll() is None
        os.write(master, b"test-secret\n")
        assert process.wait(timeout=5) == 0
        assert termios.tcgetattr(slave) == original
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)
        os.close(slave)
    (root / "shadow").write_text(f"{name}:$y$unsupported:0:0:99999:7:::\n")
    result = subprocess.run([binary, "vlock"], env=env, capture_output=True, timeout=3)
    assert result.returncode == 1 and b"supported nonempty" in result.stderr, result
    if "--root" in sys.argv:
        assert os.geteuid() == 0 and os.readlink("/proc/self/ns/net") != os.readlink("/proc/1/ns/net")
        shell = root / "shell"
        marker = root / "shell-started"
        shell.write_text(f'#!/bin/sh\ntest "$(id -u)" = 0 || exit 9\nprintf maintenance > "{marker}"\n')
        shell.chmod(0o755)
        (root / "passwd").write_text(f"root:x:0:0::{root}:{shell}\n")
        (root / "shadow").write_text(f"root:{hashed}:0:0:99999:7:::\n")
        master, slave = pty.openpty()
        process = subprocess.Popen([binary, "sulogin", "-t", "3"], stdin=slave, stdout=slave,
                                   stderr=slave, env=env, preexec_fn=attach)
        try:
            read_until(master, b"maintenance")
            os.write(master, b"test-secret\n")
            assert process.wait(timeout=5) == 0
            assert marker.read_text() == "maintenance"
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            os.close(master)
            os.close(slave)
print("PTY lock password/EOF/signal/echo checks passed" + ("; isolated maintenance-shell check passed" if "--root" in sys.argv else ""))
