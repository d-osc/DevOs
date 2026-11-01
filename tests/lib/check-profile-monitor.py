"""Synthetic kernel profiles and live read-only /proc monitoring."""
import os
from pathlib import Path
import select
import signal
import struct
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    mapping = root / "System.map"
    mapping.write_text("ffffffff81000000 T _stext\nffffffff81000010 T foo\nffffffff81000020 T bar\nffffffff81000030 A _etext\n")
    for endian in ("<", ">"):
        profile = root / "profile"
        profile.write_bytes(struct.pack(endian + "14I", 4, *range(1, 13), 0))
        result = subprocess.run([binary, "readprofile", "-p", str(profile), "-m", str(mapping)], capture_output=True, timeout=5)
        assert result.returncode == 0, result
        assert b"10 _stext" in result.stdout and b"26 foo" in result.stdout and b"42 bar" in result.stdout, result
        assert b"78 total" in result.stdout, result
        result = subprocess.run([binary, "readprofile", "-p", str(profile), "-i"], capture_output=True, timeout=5)
        assert result.returncode == 0 and result.stdout == b"Sampling_step: 4\n", result
    subprocess.run([binary, "readprofile", "-p", str(profile), "-M", "7"], check=True, timeout=5)
    assert profile.read_bytes()[:4] == struct.pack("<I", 7)
    subprocess.run([binary, "readprofile", "-p", str(profile), "-r"], check=True, timeout=5)
    assert profile.read_bytes()[0] == 0

format_string = "%[c12] %m %[mf] %[mt] %s %f %i %0i %x %p %[pn] %b %[nlo] %3t %20d"
process = subprocess.Popen([binary, "nmeter", format_string], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    for index in range(100):
        assert select.select([process.stdout], [], [], 3)[0], process.poll()
        line = process.stdout.readline()
        assert line.startswith(b"[") and len(line.split(b"]", 1)[0]) == 13, line
        assert b":" in line and len(line.split()) >= 15, line
    process.send_signal(signal.SIGTERM)
    stdout, stderr = process.communicate(timeout=3)
    assert process.returncode == 0, (stdout, stderr)
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
result = subprocess.run([binary, "nmeter", "%[unknown]"], capture_output=True, timeout=3)
assert result.returncode == 1
print("profile endian/symbol/control and live monitor format/sampling/signal checks passed")
