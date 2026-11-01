"""XMODEM CRC/1K reception with retransmission, duplicate blocks and cancel."""
import binascii
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())


def packet(sequence, data):
    return bytes((1 if len(data) == 128 else 2, sequence, 255 - sequence)) + data + binascii.crc_hqx(data, 0).to_bytes(2, "big")


with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "received"
    parent, child = socket.socketpair()
    with parent, child:
        parent.settimeout(3)
        process = subprocess.Popen([binary, "rx", str(path)], stdin=child, stdout=child,
                                   stderr=subprocess.PIPE)
        assert parent.recv(1) == b"C"
        first = packet(1, bytes(range(128)))
        damaged = bytearray(first)
        damaged[-1] ^= 1
        parent.sendall(damaged)
        assert parent.recv(1) == b"\x15"
        parent.sendall(first)
        assert parent.recv(1) == b"\x06"
        parent.sendall(first)
        assert parent.recv(1) == b"\x06"
        second = bytes(range(256)) * 4
        parent.sendall(packet(2, second))
        assert parent.recv(1) == b"\x06"
        parent.sendall(b"\x04")
        assert parent.recv(1) == b"\x06"
        assert process.wait(timeout=3) == 0, process.communicate()
        assert path.read_bytes() == bytes(range(128)) + second
    for cancellation in ("remote", "signal"):
        destination = path.with_name(cancellation)
        parent, child = socket.socketpair()
        with parent, child:
            parent.settimeout(3)
            process = subprocess.Popen([binary, "rx", str(destination)], stdin=child, stdout=child,
                                       stderr=subprocess.PIPE)
            assert parent.recv(1) == b"C"
            if cancellation == "signal":
                process.send_signal(signal.SIGTERM)
            else:
                parent.sendall(b"\x18")
            assert process.wait(timeout=3) == 1
            assert not destination.exists()
print("XMODEM CRC/1K, retransmission, duplicate-block and cancellation checks passed")
