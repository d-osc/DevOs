"""Real PTY login prompting/editing, exec arguments and timeout restoration."""
import json
import os
from pathlib import Path
import pty
import select
import subprocess
import sys
import tempfile
import termios
import time

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    marker = root / "login.json"
    helper = root / "login"
    helper.write_text(f'''#!/usr/bin/python3
import json, os, sys
from pathlib import Path
assert all(os.isatty(fd) for fd in (0, 1, 2))
Path({str(marker)!r}).write_text(json.dumps({{"args":sys.argv[1:], "term":os.environ.get("TERM")}}))
print("LOGIN-HELPER")
''')
    helper.chmod(0o755)
    issue = root / "issue"
    issue.write_text("Test \\s on \\l\n")
    master, slave = pty.openpty()
    try:
        process = subprocess.Popen([binary, "getty", "-L", "-f", str(issue), "-l", str(helper),
                                    "-t", "3", "9600", os.ttyname(slave), "vt100"],
                                   stdin=slave, stdout=slave, stderr=slave)
        received = bytearray()
        deadline = time.monotonic() + 3
        while b"login: " not in received and time.monotonic() < deadline:
            if select.select([master], [], [], .1)[0]:
                received.extend(os.read(master, 4096))
        assert b"Test Linux" in received and b"login: " in received, received
        os.write(master, b"tesx\x7fter\r")
        assert process.wait(timeout=3) == 0, received
        result = json.loads(marker.read_text())
        assert result == {"args": ["--", "tester"], "term": "vt100"}, result
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)
        os.close(slave)
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    try:
        process = subprocess.Popen([binary, "getty", "-L", "-i", "-t", "1", "9600", os.ttyname(slave)],
                                   stdin=slave, stdout=slave, stderr=slave)
        assert process.wait(timeout=3) == 1
        assert termios.tcgetattr(slave) == original
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)
        os.close(slave)
print("getty PTY issue/prompt/editing/login exec and timeout restoration checks passed")
