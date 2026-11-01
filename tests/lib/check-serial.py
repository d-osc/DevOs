"""Real PTYs for serial copying/timeout/restoration, socketpair for modem chat."""
import os
from pathlib import Path
import pty
import select
import signal
import socket
import subprocess
import sys
import termios
import time

binary = str(Path(sys.argv[1]).resolve())
master, slave = pty.openpty()
device = os.ttyname(slave)
original = termios.tcgetattr(slave)
process = subprocess.Popen([binary, "microcom", "-t", "3000", device],
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    time.sleep(.1)
    process.stdin.write(b"serial-input")
    process.stdin.flush()
    received = bytearray()
    deadline = time.monotonic() + 3
    while len(received) < len(b"serial-input") and time.monotonic() < deadline:
        if select.select([master], [], [], .1)[0]:
            received.extend(os.read(master, 4096))
    assert received == b"serial-input", received
    os.write(master, b"device-output")
    assert select.select([process.stdout], [], [], 2)[0]
    assert os.read(process.stdout.fileno(), 4096) == b"device-output"
    process.stdin.write(b"\x18")
    process.stdin.flush()
    process.wait(timeout=3)
    assert process.returncode == 0
    assert termios.tcgetattr(slave) == original
finally:
    if process.poll() is None:
        process.kill()
        process.wait()

for reason in ("timeout", "signal"):
    process = subprocess.Popen([binary, "microcom", "-t", "150", device],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(.05)
    if reason == "signal":
        process.send_signal(signal.SIGTERM)
    process.wait(timeout=3)
    assert process.returncode == (143 if reason == "signal" else 0), process.returncode
    assert termios.tcgetattr(slave) == original
os.close(master)
os.close(slave)

def read_line(sock):
    data = bytearray()
    while not data.endswith(b"\r"):
        data.extend(sock.recv(1))
    return bytes(data)

parent, child = socket.socketpair()
with parent, child:
    parent.settimeout(3)
    process = subprocess.Popen([binary, "chat", "", "AT", "OK", "DIAL", "CONNECT"],
                               stdin=child, stdout=child, stderr=subprocess.PIPE)
    assert read_line(parent) == b"AT\r"
    parent.sendall(b"modem: OK")
    assert read_line(parent) == b"DIAL\r"
    parent.sendall(b"CONNECT")
    assert process.wait(timeout=3) == 0, process.communicate()
parent, child = socket.socketpair()
with parent, child:
    process = subprocess.Popen([binary, "chat", "ABORT", "BUSY", "CONNECT"],
                               stdin=child, stdout=child, stderr=subprocess.PIPE)
    parent.sendall(b"BUSY")
    assert process.wait(timeout=3) == 4
parent, child = socket.socketpair()
with parent, child:
    process = subprocess.Popen([binary, "chat", "TIMEOUT", "1", "CONNECT"],
                               stdin=child, stdout=child, stderr=subprocess.PIPE)
    assert process.wait(timeout=3) == 3
print("serial PTY copy, timeout, signal restoration and modem chat checks passed")
