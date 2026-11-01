"""Independent DHCP wire peers, lease compatibility, and optional isolated network tests."""
import os
from pathlib import Path
import select
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time

binary = str(Path(sys.argv[1]).resolve())
oracle = os.environ.get("BUSYBOX_ORACLE", "/home/ondev/devos/busybox-1.38.0/busybox")

def run(*args, status=0, tool=binary, timeout=12):
    result = subprocess.run([tool, *args], capture_output=True, timeout=timeout)
    assert result.returncode == status, (args, result)
    return result.stdout

def wait(predicate, timeout=5):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(.03)
    raise AssertionError("timed out waiting for DHCP state")

def stop(process):
    if process.poll() is None:
        process.terminate()
    output = process.communicate(timeout=5)
    assert process.returncode == 0, (process.returncode, output)

def checksum(data):
    if len(data) % 2:
        data += b"\0"
    value = sum(struct.unpack("!%dH" % (len(data) // 2), data))
    while value >> 16:
        value = (value & 65535) + (value >> 16)
    return value ^ 65535

def options(message):
    assert message[236:240] == b"\x63\x82\x53\x63"
    result = {}
    at = 240
    while at < len(message):
        code = message[at]
        at += 1
        if code == 255:
            return result
        if code == 0:
            continue
        size = message[at]
        at += 1
        assert at + size <= len(message)
        result[code] = result.get(code, b"") + message[at:at + size]
        at += size
    raise AssertionError("missing option terminator")

class Peer:
    def __init__(self, interface):
        self.socket = socket.socket(socket.AF_PACKET, socket.SOCK_DGRAM, socket.htons(0x800))
        self.socket.bind((interface, 0))
        self.interface = interface
        self.mac = self.socket.getsockname()[4]
        self.xid = 0x1234abcd

    def send(self, kind, ip=None, server=None, ciaddr=None, xid=None, malformed=False):
        message = bytearray(240)
        message[:4] = b"\x01\x01\x06\x00"
        struct.pack_into("!I", message, 4, self.xid if xid is None else xid)
        struct.pack_into("!H", message, 10, 32768)
        if ciaddr:
            message[12:16] = socket.inet_aton(ciaddr)
        message[28:34] = self.mac
        message[236:240] = b"\x63\x82\x53\x63"
        message += bytes((53, 1, kind)) + b"\x0c\x08wirepeer"
        if ip:
            message += b"\x32\x04" + socket.inet_aton(ip)
        if server:
            message += b"\x36\x04" + socket.inet_aton(server)
        message += b"\x06\xff\x01" if malformed else b"\xff"
        message += b"\0" * max(0, 300 - len(message))
        udp = struct.pack("!HHHH", 68, 67, 8 + len(message), 0) + message
        header = bytearray(struct.pack("!BBHHHBBH4s4s", 69, 0, 20 + len(udp), 0, 0, 64, 17, 0, socket.inet_aton(ciaddr or "0.0.0.0"), b"\xff" * 4))
        struct.pack_into("!H", header, 10, checksum(header))
        self.socket.sendto(header + udp, (self.interface, 0x800, 0, 1, b"\xff" * 6))

    def receive(self, kind, timeout=3):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if not select.select([self.socket], [], [], max(0, end - time.monotonic()))[0]:
                break
            data = self.socket.recv(8192)
            if len(data) < 28 or data[9] != 17:
                continue
            header = (data[0] & 15) * 4
            if struct.unpack_from("!HH", data, header) != (67, 68):
                continue
            message = data[header + 8:]
            if len(message) < 240 or message[28:34] != self.mac or struct.unpack_from("!I", message, 4)[0] != self.xid:
                continue
            fields = options(message)
            if fields[53] == bytes((kind,)):
                return message, fields
        raise AssertionError(f"no DHCP message type {kind}")

if "--relay-peer" in sys.argv:
    assert os.geteuid() == 0 and os.readlink("/proc/self/ns/net") != os.readlink("/proc/1/ns/net")
    print("ready", flush=True)
    assert sys.stdin.readline().strip() == "go"
    run("ip", "link", "set", "vs", "up")
    run("ip", "addr", "add", "10.74.0.2/24", "dev", "vs")
    run("ip", "route", "add", "10.73.0.0/24", "via", "10.74.0.1", "dev", "vs")
    upstream = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    upstream.bind(("10.74.0.2", 67))
    upstream.settimeout(5)
    print("listening", flush=True)
    forwarded, sender = upstream.recvfrom(4096)
    assert forwarded[3] == 1 and forwarded[24:28] == socket.inet_aton("10.73.0.1"), forwarded[:28]
    assert options(forwarded)[53] == b"\x01"
    response = bytearray(forwarded[:240])
    response[0] = 2
    response[16:20] = socket.inet_aton("10.73.0.11")
    response += bytes((53, 1, 2, 54, 4)) + socket.inet_aton("10.74.0.2") + b"\xff"
    response += b"\0" * max(0, 300 - len(response))
    upstream.sendto(response, ("10.73.0.1", 67))
    upstream.close()
    print("relay peer passed", flush=True)
    sys.exit(0)

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    leasefile = root / "leases"
    leasefile.write_bytes(struct.pack("!QII6s20s2x", int(time.time()), 3600, 0xc000020a, bytes.fromhex("020000000001"), b"testhost"))
    native = run("dumpleases", "-f", str(leasefile))
    assert b"02:00:00:00:00:01 192.0.2.10" in native and b"testhost" in native
    if Path(oracle).exists():
        comparison = run("dumpleases", "-f", str(leasefile), tool=oracle)
        assert native.splitlines()[0] == comparison.splitlines()[0]
        assert native.splitlines()[1].split()[:3] == comparison.splitlines()[1].split()[:3]
    assert b"Expires at" in run("dumpleases", "-a", "-f", str(leasefile))
    leasefile.write_bytes(b"corrupt")
    run("dumpleases", "-f", str(leasefile), status=1)
    run("udhcpc", "-t", "-1", status=1)
    run("dhcprelay", status=1)
    config = root / "config"
    config.write_text("unknown_feature yes\n")
    run("udhcpd", "-f", str(config), status=1)

    if "--namespace" in sys.argv:
        assert os.geteuid() == 0 and os.readlink("/proc/self/ns/net") != os.readlink("/proc/1/ns/net")
        assert [line.split(":")[0].strip() for line in Path("/proc/net/dev").read_text().splitlines()[2:]] == ["lo"]
        run("ip", "link", "add", "va", "type", "veth", "peer", "name", "vb")
        for interface in ("lo", "va", "vb"):
            run("ip", "link", "set", interface, "up")
        run("ip", "addr", "add", "10.73.0.1/24", "dev", "vb")
        pidfile = root / "server.pid"
        clientpid = root / "client.pid"
        log = root / "actions"
        helper = root / "script"
        helper.write_text(f'#!/bin/sh\nprintf "%s %s %s %s %s %s\\n" "$1" "$interface" "$ip" "$subnet" "$router" "$dns" >> "{log}"\n')
        helper.chmod(0o755)
        def configure(lifetime=8):
            config.write_text(f"interface vb\nstart 10.73.0.10\nend 10.73.0.12\nlease_file {leasefile}\npidfile {pidfile}\nauto_time 1\nmin_lease 1\noption lease {lifetime}\noption subnet 255.255.255.0\noption router 10.73.0.1\noption dns 192.0.2.53\n")
            leasefile.unlink(missing_ok=True)
        def launch(tool=binary):
            process = subprocess.Popen([tool, "udhcpd", "-f", str(config)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            wait(lambda: pidfile.exists() or process.poll() is not None)
            assert process.poll() is None, process.communicate()
            return process
        configure()
        server = launch()
        try:
            peer = Peer("va")
            peer.send(1, malformed=True)
            try:
                peer.receive(2, .2)
                raise AssertionError("server accepted malformed options")
            except AssertionError as error:
                assert "no DHCP" in str(error), error
            peer.send(1)
            offer, fields = peer.receive(2)
            address = socket.inet_ntoa(offer[16:20])
            server_ip = socket.inet_ntoa(fields[54])
            assert address == "10.73.0.10" and server_ip == "10.73.0.1", (address, fields)
            peer.send(3, ip=address, server=server_ip)
            ack, fields = peer.receive(5)
            assert fields[1] == socket.inet_aton("255.255.255.0") and fields[6] == socket.inet_aton("192.0.2.53")
            wait(leasefile.exists)
            if Path(oracle).exists():
                assert b"wirepeer" in run("dumpleases", "-f", str(leasefile), tool=oracle)
            peer.send(3, ip="10.73.9.9", server=server_ip)
            peer.receive(6)
            peer.socket.close()
            run("udhcpc", "-f", "-n", "-q", "-i", "va", "-s", str(helper), "-t", "2", "-T", "1")
            assert "bound va 10.73.0.10 255.255.255.0 10.73.0.1 192.0.2.53" in log.read_text(), log.read_text()
            log.unlink()
            client = subprocess.Popen([binary, "udhcpc", "-f", "-n", "-R", "-i", "va", "-s", str(helper), "-p", str(clientpid), "-T", "1"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                wait(lambda: log.exists() and "renew va" in log.read_text(), 8)
                client.send_signal(signal.SIGUSR2)
                wait(lambda: log.read_text().count("deconfig") >= 2)
                client.send_signal(signal.SIGUSR1)
                wait(lambda: log.read_text().count("bound va") >= 2)
            finally:
                stop(client)
            assert not clientpid.exists()
            if Path(oracle).exists():
                run("udhcpc", "-f", "-n", "-q", "-i", "va", "-s", str(helper), "-t", "2", "-T", "1", tool=oracle)
        finally:
            stop(server)
        assert not pidfile.exists()
        # Native client against an independently built BusyBox server.
        if Path(oracle).exists():
            configure(60)
            server = launch(oracle)
            try:
                run("udhcpc", "-f", "-n", "-q", "-i", "va", "-s", str(helper), "-t", "3", "-T", "1")
                server.send_signal(signal.SIGUSR1)
                wait(leasefile.exists)
                assert b"10.73.0.10" in run("dumpleases", "-f", str(leasefile))
            finally:
                stop(server)
        # Put the upstream peer in a second namespace so local routing cannot
        # short-circuit the veth link. Both namespaces are disposable.
        run("ip", "link", "add", "vr", "type", "veth", "peer", "name", "vs")
        run("ip", "link", "set", "vr", "up")
        run("ip", "addr", "add", "10.74.0.1/24", "dev", "vr")
        upstream = subprocess.Popen(["unshare", "-n", sys.executable, __file__, binary, "--relay-peer"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert upstream.stdout.readline().strip() == "ready"
        subprocess.run(["ip", "link", "set", "vs", "netns", str(upstream.pid)], check=True)
        upstream.stdin.write("go\n")
        upstream.stdin.flush()
        assert upstream.stdout.readline().strip() == "listening"
        relay = subprocess.Popen([binary, "dhcprelay", "vb", "vr", "10.74.0.2"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        peer = Peer("va")
        try:
            time.sleep(.15)
            peer.send(1)
            offer, fields = peer.receive(2)
            assert offer[16:20] == socket.inet_aton("10.73.0.11") and fields[54] == socket.inet_aton("10.74.0.2")
            output = upstream.communicate(timeout=3)
            assert upstream.returncode == 0 and "relay peer passed" in output[0], output
        finally:
            peer.socket.close()
            if upstream.poll() is None:
                upstream.kill()
                upstream.wait()
            stop(relay)
        # With no server or relay left, -n must fail rather than loop forever.
        run("udhcpc", "-f", "-n", "-i", "va", "-s", str(helper), "-t", "1", "-T", "1", status=1)
print("DHCP lease/argument checks passed" + ("; wire DORA/NAK/renew/release relay forwarding, and bidirectional BusyBox interoperability passed" if "--namespace" in sys.argv else ""))
