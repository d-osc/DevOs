"""Boot the staged repository userland; no host libraries are added to the image."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from usb_support import usb

stage = Path(sys.argv[1]).resolve()
kernel = Path(sys.argv[2]).resolve()
with tempfile.TemporaryDirectory(prefix="devos-repo-userland-qemu-") as directory:
    root = Path(directory)
    tree = root / "rootfs"
    shutil.copytree(stage, tree, symlinks=True)
    for name in ("proc", "sys", "dev", "tmp", "run", "root"):
        (tree / name).mkdir(exist_ok=True)
    (tree / "init").write_text('''#!/bin/sh
set -eu
export PATH=/bin:/usr/bin:/sbin:/usr/sbin HOME=/root
mount -t devtmpfs devtmpfs /dev
mount -t sysfs sysfs /sys
ip link set lo up
export DEV_ROOT=/tmp/store XDG_DATA_HOME=/tmp/data DEV_BIN_DIR=/tmp/commands
mkdir -p /tmp/hello/bin "$DEV_BIN_DIR" "$XDG_DATA_HOME"
printf '%s' '{"name":"hello","version":"1.0.0","bin":{"hello":"bin/hello"}}' >/tmp/hello/package.json
printf '#!/bin/sh\\necho REPO_PACKAGE_EXECUTED\\n' >/tmp/hello/bin/hello
chmod 755 /tmp/hello/bin/hello
cd /tmp
dev --version
dev catalog --json >/tmp/catalog.json
grep -q firefox /tmp/catalog.json
dev pack hello
dev install hello-1.0.0.dpk
dev verify
dev run hello
dev remove hello
echo DEVOS_REPO_USERLAND_BOOT_PASS
sync
poweroff -f
''')
    (tree / "init").chmod(0o755)
    initramfs = root / "initramfs.cpio.gz"
    usb.cpio(tree, initramfs)
    result = subprocess.run(["qemu-system-aarch64", "-machine", "virt", "-cpu", "cortex-a72", "-accel", "tcg,thread=multi", "-smp", "2", "-m", "768", "-nographic", "-no-reboot", "-kernel", str(kernel), "-initrd", str(initramfs), "-append", "console=ttyAMA0 rdinit=/init panic=-1"], capture_output=True, timeout=120)
    log = result.stdout + result.stderr
    assert result.returncode == 0 and b"DEVOS_REPO_USERLAND_BOOT_PASS" in log and b"REPO_PACKAGE_EXECUTED" in log and b"Kernel panic" not in log, log[-14000:].decode(errors="replace")
    print("QEMU booted repository busybox-cli + pm-cli, packed/installed/ran/removed a package, and powered off")
