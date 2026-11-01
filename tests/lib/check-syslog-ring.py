"""Shared-memory syslog checks; compatibility mode uses private IPC/mount namespaces."""
import os
from pathlib import Path
import signal
import stat
import select
import socket
import subprocess
import sys
import tempfile
import time

binary = str(Path(sys.argv[1]).resolve())
oracle = os.environ.get("BUSYBOX_ORACLE", "/home/ondev/devos/busybox-1.38.0/busybox")
def wait_socket(path, process):
    deadline = time.monotonic() + 3
    while not path.exists() and time.monotonic() < deadline:
        assert process.poll() is None, process.communicate()
        time.sleep(.01)
    assert path.exists()


if "--compat" in sys.argv:
    assert os.geteuid() == 0
    for namespace in ("ipc", "mnt"):
        assert os.readlink(f"/proc/self/ns/{namespace}") != os.readlink(f"/proc/1/ns/{namespace}")
    subprocess.run(["mount", "--make-rprivate", "/"], check=True)
    for path in ("/dev", "/run"):
        subprocess.run(["mount", "-t", "tmpfs", "tmpfs", path], check=True)
    os.mknod("/dev/null", stat.S_IFCHR | 0o666, os.makedev(1, 3))
    env = {key: value for key, value in os.environ.items() if key not in ("BUSYBOX_DEVLOG", "BUSYBOX_LOG_KEY")}
    for writer, reader in ((oracle, binary), (binary, oracle)):
        Path("/dev/log").unlink(missing_ok=True)
        process = subprocess.Popen([writer, "syslogd", "-n", "-C16"], env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            wait_socket(Path("/dev/log"), process)
            subprocess.run([oracle, "logger", "compatibility-message"], env=env, check=True)
            time.sleep(.05)
            output = subprocess.check_output([reader, "logread"], env=env, timeout=5)
            assert b"compatibility-message" in output, output
        finally:
            process.terminate()
            process.communicate(timeout=3)
    print("cross-implementation SysV ring/semaphore compatibility checks passed")
    sys.exit(0)

with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "log"
    env = {**os.environ, "BUSYBOX_DEVLOG": str(path), "BUSYBOX_LOG_KEY": str((os.getpid() * 257) % 0x7FFFFFFF)}
    process = subprocess.Popen([binary, "syslogd", "-n", "-C1"], env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    follower = None
    try:
        wait_socket(path, process)
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as client:
            for index in range(50):
                client.sendto(f"<13>tag: ring-message-{index:02d} abcdefghijklmnopqrstuvwxyz".encode(), str(path))
            time.sleep(.05)
            output = subprocess.check_output([binary, "logread"], env=env, timeout=3)
            assert b"ring-message-49" in output and b"ring-message-00" not in output, output
            follower = subprocess.Popen([binary, "logread", "-f"], env=env,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert select.select([follower.stdout], [], [], 3)[0]
            os.read(follower.stdout.fileno(), 65536)
            client.sendto(b"<-1>tag: invalid-priority", str(path))
            deadline = time.monotonic() + 3
            data = bytearray()
            while b"invalid-priority" not in data and time.monotonic() < deadline:
                if select.select([follower.stdout], [], [], .1)[0]:
                    data.extend(os.read(follower.stdout.fileno(), 65536))
            assert b"invalid-priority" in data and process.poll() is None, data
        follower.terminate()
        follower.communicate(timeout=3)
        assert follower.returncode == 0
    finally:
        if follower is not None and follower.poll() is None:
            follower.kill()
            follower.wait()
        process.terminate()
        process.communicate(timeout=3)
    result = subprocess.run([binary, "logread"], env=env, capture_output=True, timeout=3)
    assert result.returncode == 1
print("SysV ring wrap/follow/priority validation and IPC cleanup checks passed")
