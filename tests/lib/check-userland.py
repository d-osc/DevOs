"""Verify a staged image using only its repo userland, including real package operations."""
import fcntl
import hashlib
import json
import os
import pty
import select
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

stage = Path(sys.argv[1]).resolve()

def run(command, **options):
    result = subprocess.run(command, capture_output=True, text=True, timeout=90, **options)
    assert result.returncode == 0, (command, result.stdout, result.stderr)
    return result.stdout

for name in ("bin/busybox", "usr/libexec/devos/dash", "usr/bin/d", "usr/bin/devrun"):
    data = (stage / name).read_bytes()
    assert data[:6] == b"\x7fELF\x02\x01", name
    offset = struct.unpack_from("<Q", data, 32)[0]
    size, count = struct.unpack_from("<HH", data, 54)
    assert not any(struct.unpack_from("<I", data, offset + i * size)[0] in (2, 3) for i in range(count)), name
assert "sh" in run([str(stage / "bin/busybox"), "--list"]).splitlines()
with tempfile.TemporaryDirectory() as lockdir:
    target = str(Path(lockdir) / "guard")
    with open(target, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        assert subprocess.run([str(stage / "bin/busybox"), "flock", "-n", target, "true"]).returncode == 1
    assert "LOCK_OK" in run([str(stage / "bin/busybox"), "flock", "-x", target, "sh", "-c", "echo LOCK_OK"])
assert (stage / "usr/share/devos-pm/cli/main.dev").is_file()
assert json.loads((stage / "usr/share/devos-pm/provenance.json").read_text())["project"].endswith("pm-cli")
record = json.loads((stage / "usr/share/devos-busybox/provenance.json").read_text())
assert record["project"].endswith("busybox-cli")
assert record["sha256"] == hashlib.sha256((stage / "bin/busybox").read_bytes()).hexdigest()
# Acquire a controlling PTY in a fresh session; exercise the real ioctl.
master, slave = pty.openpty()
try:
    process = subprocess.Popen([str(stage / "bin/busybox"), "cttyhack", "/bin/sh", "-c", "test -c /dev/tty && echo CTTY_OK"], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    assert process.wait(timeout=3) == 0
    assert select.select([master], [], [], 1)[0] and b"CTTY_OK" in os.read(master, 4096)
finally:
    os.close(master)
    os.close(slave)

if "--root" in sys.argv:
    assert os.geteuid() == 0
    assert os.readlink("/proc/self/ns/mnt") != os.readlink("/proc/1/ns/mnt"), "use unshare -mn"
    run(["mount", "--make-rprivate", "/"])
    (stage / "proc").mkdir(exist_ok=True)
    # PID 1 must be able to start the first /bin/sh before procfs exists.
    assert "FIRST_SHELL" in run(["unshare", "-mpf", "chroot", str(stage), "/bin/sh", "-c", "echo FIRST_SHELL"])
    run(["mount", "-t", "proc", "proc", str(stage / "proc")])
    (stage / "tmp").mkdir(exist_ok=True)
    (stage / "dev").mkdir(exist_ok=True)
    run(["mount", "--bind", "/dev", str(stage / "dev")])
    try:
        assert run(["chroot", str(stage), "/usr/bin/dev", "--version"]).strip() == "dev 0.7.0"
        catalog = json.loads(run(["chroot", str(stage), "/usr/bin/dev", "catalog", "--json"]))
        assert len(catalog["apps"]) == 6, catalog
        with tempfile.TemporaryDirectory(dir=stage / "tmp", prefix="userland-") as directory:
            work = Path(directory)
            package = work / "hello"
            (package / "bin").mkdir(parents=True)
            (package / "package.json").write_text(json.dumps({"name": "hello", "version": "1.0.0", "description": "image test", "bin": {"hello": "bin/hello"}}))
            (package / "bin/hello").write_text('#!/bin/sh\nprintf "hello %s\\n" "$1"\n')
            (package / "bin/hello").chmod(0o755)
            relative = "/" + str(work.relative_to(stage))
            script = f'''set -eu
export PATH=/bin:/usr/bin:/sbin:/usr/sbin
export HOME=/root DEV_ROOT={relative}/store XDG_DATA_HOME={relative}/data DEV_BIN_DIR={relative}/commands
mkdir -p "$DEV_BIN_DIR" "$XDG_DATA_HOME"
cd {relative}
dev pack hello
dev install hello-1.0.0.dpk
dev verify
dev run hello image
dev list --json
dev remove hello
if [ -f /root/packages/greeting-extension-1.0.0.dpk ]; then
    dev install /root/packages/greeting-extension-1.0.0.dpk
    dev run extension-hello image
    dev verify
    dev remove greeting-extension
fi
'''
            output = run(["chroot", str(stage), "/bin/sh", "-ec", script])
            assert "hello image" in output, output
    finally:
        run(["umount", str(stage / "dev")])
        run(["umount", str(stage / "proc")])
    print("Isolated first-shell boot, pm-cli version/pack/install/verify/run/list/remove passed")
else:
    print("Static ELF, repository provenance, launcher and shell inventory checks passed")
