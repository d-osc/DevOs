"""Fake sysfs/rules/firmware; optional real mknod only inside a temporary tree."""
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    sysfs = root / "sys"
    dev = root / "dev"
    etc = root / "etc"
    firmware = root / "firmware"
    device = sysfs / "devices/demo"
    for path in (device, dev, etc, firmware):
        path.mkdir(parents=True)
    marker = root / "actions"
    (device / "dev").write_text("1:3\n")
    (device / "uevent").write_text("DEVNAME=sample1\nSUBSYSTEM=char\n")
    env = {**os.environ, "BUSYBOX_SYS": str(sysfs), "BUSYBOX_DEV": str(dev),
           "BUSYBOX_ETC": str(etc), "BUSYBOX_FIRMWARE": str(firmware)}
    (etc / "mdev.conf").write_text(f'sample([0-9]+) 0:0 640 ! *printf "%s:%s\\n" "$ACTION" "$MDEV" >> "{marker}"\n')

    def run(*args, status=0, **extra):
        result = subprocess.run([binary, "mdev", *args], env={**env, **extra}, capture_output=True, timeout=5)
        assert result.returncode == status, result

    run("-s")
    assert marker.read_text() == "add:sample1\n" and not (dev / "sample1").exists()
    run(ACTION="remove", DEVPATH="/devices/demo", DEVNAME="sample1", MAJOR="1", MINOR="3", SUBSYSTEM="char")
    assert marker.read_text().endswith("remove:sample1\n")
    run(status=1, ACTION="add", DEVPATH="/../escape")
    request = sysfs / "devices/firmware"
    request.mkdir()
    (request / "loading").write_bytes(b"")
    (request / "data").write_bytes(b"")
    payload = bytes(range(256))
    (firmware / "test.bin").write_bytes(payload)
    run(ACTION="add", DEVPATH="/devices/firmware", FIRMWARE="test.bin")
    assert (request / "loading").read_bytes() == b"0" and (request / "data").read_bytes() == payload
    run(status=1, ACTION="add", DEVPATH="/devices/firmware", FIRMWARE="missing.bin")
    assert (request / "loading").read_bytes() == b"-1"
    if "--root" in sys.argv:
        assert os.geteuid() == 0 and os.readlink("/proc/self/ns/mnt") != os.readlink("/proc/1/ns/mnt")
        (etc / "mdev.conf").write_text("sample([0-9]+) 0:0 640 >disk/%1\n")
        run("-s")
        node = dev / "disk/1"
        details = node.stat()
        assert stat.S_ISCHR(details.st_mode) and (os.major(details.st_rdev), os.minor(details.st_rdev)) == (1, 3)
        assert stat.S_IMODE(details.st_mode) == 0o640
        assert (dev / "sample1").is_symlink() and (dev / "sample1").resolve() == node
        run(ACTION="remove", DEVPATH="/devices/demo", DEVNAME="sample1", MAJOR="1", MINOR="3", SUBSYSTEM="char")
        assert not node.exists() and not (dev / "sample1").is_symlink()
        (dev / "disk").rmdir()
        outside = root / "outside"
        outside.mkdir()
        (dev / "disk").symlink_to(outside, target_is_directory=True)
        run("-s", status=1)
        assert not (outside / "1").exists()
print("mdev scan/hotplug/config/firmware checks passed" + ("; scoped node/rename/removal checks passed" if "--root" in sys.argv else ""))
