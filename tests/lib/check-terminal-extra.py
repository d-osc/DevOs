"""Exercise real PTYs, cursor-size negotiation, recording and replay."""
import errno
import fcntl
import os
from pathlib import Path
import pty
import select
import struct
import subprocess
import sys
import tempfile
import termios
import time

binary = str(Path(sys.argv[1]).resolve())


def resize(response, expected):
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)

    def attach():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

    process = subprocess.Popen([binary, "resize"], stdin=slave, stdout=slave,
                               stderr=slave, preexec_fn=attach)
    received = bytearray()
    replied = False
    try:
        deadline = time.monotonic() + 5
        while process.poll() is None and time.monotonic() < deadline:
            if select.select([master], [], [], .1)[0]:
                received.extend(os.read(master, 4096))
                if b"\x1b[6n" in received and not replied:
                    os.write(master, response)
                    replied = True
        process.wait(timeout=3)
        while select.select([master], [], [], .05)[0]:
            received.extend(os.read(master, 4096))
        assert process.returncode == expected, received
        assert termios.tcgetattr(slave) == original, "terminal attributes were not restored"
        if expected == 0:
            size = struct.unpack("HHHH", fcntl.ioctl(slave, termios.TIOCGWINSZ, bytes(8)))
            assert size[:2] == (40, 120), size
            assert b"COLUMNS=120;LINES=40;export COLUMNS LINES;" in received, received
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)
        os.close(slave)


resize(b"\x1b[40;120R", 0)
resize(b"\x1b[0;120R", 1)
master, slave = pty.openpty()
original = termios.tcgetattr(slave)
def attach_showkey():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)
process = subprocess.Popen([binary, "showkey", "-a"], stdin=slave, stdout=slave,
                           stderr=slave, preexec_fn=attach_showkey)
try:
    assert select.select([master], [], [], 3)[0]
    received = os.read(master, 4096)
    os.write(master, b"A\x04")
    process.wait(timeout=3)
    while select.select([master], [], [], .05)[0]:
        received += os.read(master, 4096)
    assert process.returncode == 0 and b"65 0101 0x41" in received, received
    assert termios.tcgetattr(slave) == original
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    os.close(master)
    os.close(slave)
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    recording = root / "typescript"
    timing = root / "timing"
    result = subprocess.run([binary, "script", "-qt", "-c",
                             "printf 'alpha\\nbeta\\n'", str(recording)],
                            input=b"", capture_output=True, timeout=10)
    assert result.returncode == 0, result
    assert result.stdout == recording.read_bytes() == b"alpha\r\nbeta\r\n", result
    timing.write_bytes(result.stderr)
    replay = subprocess.run([binary, "scriptreplay", str(timing), str(recording), "10"],
                            capture_output=True, timeout=10)
    assert replay.returncode == 0 and replay.stdout == result.stdout, replay
    result = subprocess.run([binary, "script", "-aqf", "-c", "printf tail", str(recording)],
                            input=b"", capture_output=True, timeout=10)
    assert result.returncode == 0 and recording.read_bytes().endswith(b"beta\r\ntail"), result
    result = subprocess.run([binary, "script", "-q", "-c", "test -t 0 && test -t 1 && echo tty", str(recording)],
                            input=b"", capture_output=True, timeout=10)
    assert result.returncode == 0 and result.stdout == b"tty\r\n", result
print("real PTY resize, script recording/append and scriptreplay checks passed")
