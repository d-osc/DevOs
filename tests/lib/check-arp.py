"""ARP probes and link-local allocation; mutations require a fresh network namespace."""
import os
from pathlib import Path
import subprocess
import socket
import struct
import threading
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())

def run(*args, status=0, timeout=15):
    result = subprocess.run([binary, *args], capture_output=True, timeout=timeout)
    assert result.returncode == status, (args, result)
    return result.stdout

run("arping", "-c", "-1", "192.0.2.2", status=1)
run("zcip", "-r", "192.0.2.1", "missing", "/bin/true", status=1)
if "--namespace" in sys.argv:
    assert os.geteuid() == 0
    assert os.readlink("/proc/self/ns/net") != os.readlink("/proc/1/ns/net")
    assert [line.split(":")[0].strip() for line in Path("/proc/net/dev").read_text().splitlines()[2:]] == ["lo"]
    run("ip", "link", "add", "va", "type", "veth", "peer", "name", "vb")
    for interface, address in (("va", "192.0.2.1/24"), ("vb", "192.0.2.2/24")):
        run("ip", "link", "set", interface, "up")
        run("ip", "addr", "add", address, "dev", interface)
    # A separate Ethernet peer responds independently; both interfaces live in
    # this namespace, where the kernel treats their IPv4 addresses as local.
    peer = socket.socket(socket.AF_PACKET, socket.SOCK_DGRAM, socket.htons(0x806))
    peer.bind(("vb", 0))
    peer.settimeout(.2)
    peer_mac = peer.getsockname()[4]
    done = threading.Event()
    def respond():
        while not done.is_set():
            try:
                message, address = peer.recvfrom(2048)
            except socket.timeout:
                continue
            if len(message) < 28 or message[6:8] != b"\x00\x01":
                continue
            if socket.inet_ntoa(message[24:28]) not in ("192.0.2.2", "169.254.8.8"):
                continue
            reply = struct.pack("!HHBBH", 1, 0x800, 6, 4, 2) + peer_mac + message[24:28] + message[8:14] + message[14:18]
            peer.sendto(reply, ("vb", 0x806, 0, 1, message[8:14]))
    responder = threading.Thread(target=respond, daemon=True)
    responder.start()
    run("arping", "-I", "va", "-c", "1", "-f", "192.0.2.2")
    run("arping", "-D", "-I", "va", "-c", "1", "192.0.2.2", status=1)
    run("arping", "-D", "-I", "va", "-c", "1", "192.0.2.9")
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        helper = root / "action"
        log = root / "log"
        helper.write_text(f'#!/bin/sh\nprintf "%s %s %s\\n" "$1" "$interface" "$ip" >> "{log}"\n')
        helper.chmod(0o755)
        run("zcip", "-f", "-q", "-r", "169.254.9.9", "va", str(helper))
        assert log.read_text().splitlines() == ["init va ", "config va 169.254.9.9"]
        run("ip", "addr", "add", "169.254.8.8/16", "dev", "vb")
        log.unlink()
        run("zcip", "-f", "-q", "-r", "169.254.8.8", "va", str(helper))
        lines = log.read_text().splitlines()
        assert len(lines) == 2 and lines[1].startswith("config va 169.254.") and not lines[1].endswith("8.8"), lines
    done.set()
    responder.join(timeout=1)
    peer.close()
print("ARP argument checks passed" + ("; veth replies, duplicate detection, and link-local allocation passed" if "--namespace" in sys.argv else ""))
