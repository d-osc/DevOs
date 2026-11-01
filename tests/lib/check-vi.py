"""Exercise the native visual editor through a real PTY and verify file bytes."""
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import sys
import tempfile
import termios
import time

binary = str(Path(sys.argv[1]).resolve())

def edit(path, commands, extra=(), interrupt=False):
    master, slave = pty.openpty()
    before = termios.tcgetattr(slave)
    process = subprocess.Popen([binary, "vi", *extra, str(path)], stdin=slave, stdout=slave, stderr=slave)
    output = bytearray()
    def drain(seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if select.select([master], [], [], .02)[0]:
                output.extend(os.read(master, 65536))
    try:
        drain(.15)
        for command in commands:
            os.write(master, command)
            drain(.08)
        if interrupt:
            process.send_signal(signal.SIGTERM)
        deadline = time.monotonic() + 5
        while process.poll() is None:
            assert time.monotonic() < deadline, output[-2000:]
            drain(.05)
            assert len(output) < 4000000, "editor did not terminate"
        assert process.wait(timeout=3) == (1 if interrupt else 0), output[-2000:]
        assert termios.tcgetattr(slave) == before, "terminal modes were not restored"
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        os.close(master)
        os.close(slave)
    return output

with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "file"
    edit(path, [b"ihello\rworld", b"\x1b", b":wq\r"])
    assert path.read_bytes() == b"hello\nworld", path.read_bytes()
    path.write_bytes(b"one two\nthree\nfour\n")
    edit(path, [b"w", b"cwTWO", b"\x1b", b"jdd", b"u", b"\x12", b"P", b":wq\r"])
    assert path.read_bytes() == b"one TWO\nthree\nfour\n", path.read_bytes()
    edit(path, [b"/four\r", b"0rF", b"gg", b"A!", b"\x1b", b":wq\r"])
    assert path.read_bytes() == b"one TWO!\nthree\nFour\n", path.read_bytes()
    original = path.read_bytes()
    edit(path, [b"iBLOCKED", b"\x1b", b":q!\r"], extra=("-R",))
    assert path.read_bytes() == original
    edit(path, [b"iunsaved", b"\x1b", b":q\r", b":q!\r"])
    assert path.read_bytes() == original
    edit(path, [b"iunsaved"], interrupt=True)
    assert path.read_bytes() == original
    edit(path, [b":set "], interrupt=True)
    assert path.read_bytes() == original
    # No delay between Escape and the colon: lookahead must preserve the colon.
    edit(path, [b"iX\x1b:wq\r"])
    assert path.read_bytes() == b"X" + original
result = subprocess.run([binary, "vi"], input=b":q!\n", capture_output=True, timeout=3)
assert result.returncode == 1 and b"terminal" in result.stderr
print("vi PTY insert/motions/change/delete/yank/paste/search/undo/redo/save/read-only/signal checks passed")
