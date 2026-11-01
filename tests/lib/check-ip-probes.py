"""ICMPv6 loopback and optional raw UDP/ICMP traceroute in an isolated netns."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

binary = str(Path(sys.argv[1]).resolve())


def run(*args, status=0):
    result = subprocess.run([binary, *args], capture_output=True, timeout=8)
    assert result.returncode == status, (args, result)
    return result.stdout


if "--namespace" in sys.argv:
    assert os.geteuid() == 0 and os.readlink("/proc/self/ns/net") != os.readlink("/proc/1/ns/net")
    assert [line.split(":")[0].strip() for line in Path("/proc/net/dev").read_text().splitlines()[2:]] == ["lo"]
    run("ip", "link", "set", "lo", "up")
output = run("ping6", "-c", "2", "::1")
assert b"2 packets transmitted, 2 packets received, 0% packet loss" in output, output
run("ping6", "-c", "0", "::1", status=1)
run("ping6", "-c", "1", "-I", "no-such-device", "::1", status=1)
run("ping6", "-c", "1", "::invalid::", status=1)
process = subprocess.Popen([binary, "ping6", "-q", "::1"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
time.sleep(.15)
process.send_signal(signal.SIGINT)
stdout, stderr = process.communicate(timeout=3)
assert process.returncode == 0 and b"packets received" in stdout, (stdout, stderr)
if "--namespace" in sys.argv:
    for extra in ([], ["-I"], ["-F", "-t", "8", "-l", "-s", "127.0.0.1", "-i", "lo"]):
        output = run("traceroute", "-n", "-m", "2", "-q", "1", "-w", "1", *extra, "127.0.0.1")
        assert b"127.0.0.1" in output and b" ms" in output and b" *" not in output, output
print("IPv6 loopback/argument/signal checks passed" + ("; isolated UDP/ICMP traceroute checks passed" if "--namespace" in sys.argv else ""))
