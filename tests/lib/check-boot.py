"""PID-1 guards plus opt-in boot tests in fresh PID/mount/network namespaces.

The switch-root test deletes only a temporary tmpfs chroot built by this test.
It never runs the deletion code against the host/WSL root filesystem.
"""
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

binary = str(Path(sys.argv[1]).resolve())
oracle = os.environ.get("BUSYBOX_ORACLE", "/home/ondev/devos/busybox-1.38.0/busybox")


def copy_runtime(root):
    (root / "bin").mkdir(parents=True)
    shutil.copy2(binary, root / "bin/busybox")
    for source in re.findall(r"(/[^\s()]+)", subprocess.check_output(["ldd", binary], text=True)):
        path = Path(source)
        if path.is_file():
            destination = root / source.lstrip("/")
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    shutil.copy2(oracle, root / "bin/sh")
    (root / "bin/sleep").symlink_to("sh")
    for directory in ("etc", "proc", "dev"):
        (root / directory).mkdir(exist_ok=True)


def namespace_child(mode, root):
    assert os.getpid() == 1 and os.geteuid() == 0
    subprocess.run(["mount", "--make-rprivate", "/"], check=True)
    if mode == "--switch-child":
        subprocess.run(["mount", "-t", "tmpfs", "tmpfs", str(root)], check=True)
    copy_runtime(root)
    subprocess.run(["mount", "-t", "proc", "proc", str(root / "proc")], check=True)
    if mode == "--switch-child":
        target = root / "newroot"
        target.mkdir()
        subprocess.run(["mount", "-t", "tmpfs", "tmpfs", str(target)], check=True)
        (target / "bin").mkdir()
        shutil.copy2(oracle, target / "bin/sh")
        (target / "proc").mkdir()
        subprocess.run(["mount", "-t", "proc", "proc", str(target / "proc")], check=True)
        (root / "protected").mkdir()
        subprocess.run(["mount", "-t", "tmpfs", "tmpfs", str(root / "protected")], check=True)
        (root / "protected/safe").write_text("keep")
        (target / "keep").mkdir()
        subprocess.run(["mount", "--bind", str(root / "protected"), str(target / "keep")], check=True)
        (root / "old-marker").write_text("remove")
        descriptor = os.open(root, os.O_RDONLY)
        os.dup2(descriptor, 9)
        os.set_inheritable(9, True)
        os.execvp("chroot", ["chroot", str(root), "/bin/busybox", "switch_root", "/newroot", "/bin/sh", "-c",
                             "test ! -e /proc/self/fd/9/old-marker && test -f /keep/safe && echo switch-root-ok"])
    (root / "etc/inittab").write_text("::sysinit:echo sysinit >> /events\n::wait:echo wait >> /events\n::once:echo once >> /events\n::respawn:echo respawn >> /events; /bin/sleep 0.1\n::ctrlaltdel:echo cad >> /events\n::shutdown:echo shutdown >> /events\n")
    os.execvp("chroot", ["chroot", str(root), "/bin/busybox", "init"])


mode = next((arg for arg in sys.argv if arg in ("--switch-child", "--init-child")), None)
if mode:
    namespace_child(mode, Path(sys.argv[-1]))
    raise AssertionError("exec did not occur")
for applet in ("init", "switch_root"):
    result = subprocess.run([binary, applet], capture_output=True, timeout=3)
    assert result.returncode == 1 and b"PID 1" in result.stderr, result
if "--root" not in sys.argv:
    print("PID-1-only init/switch_root guards passed; namespace boot checks require --root")
    sys.exit(0)
assert os.geteuid() == 0
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    switch = root / "switch"
    switch.mkdir()
    result = subprocess.run(["unshare", "-mnpf", "--mount-proc", sys.executable, __file__, binary,
                             "--switch-child", str(switch)], capture_output=True, timeout=15)
    assert result.returncode == 0 and b"switch-root-ok" in result.stdout, result
    init = root / "init"
    init.mkdir()
    process = subprocess.Popen(["unshare", "-mnpf", "--mount-proc", sys.executable, __file__, binary,
                                "--init-child", str(init)], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)

    def wait_for(predicate):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if predicate():
                return
            assert process.poll() is None, process.communicate()
            time.sleep(.05)
        raise AssertionError("PID-1 init did not produce expected event")

    try:
        events = init / "events"
        wait_for(lambda: events.exists() and events.read_text().count("respawn\n") >= 2)
        children = Path(f"/proc/{process.pid}/task/{process.pid}/children").read_text().split()
        assert len(children) == 1, children
        pid = int(children[0])
        os.kill(pid, signal.SIGINT)
        wait_for(lambda: "cad\n" in events.read_text())
        (init / "etc/inittab").write_text("::once:echo reloaded >> /events\n::shutdown:echo shutdown >> /events\n")
        os.kill(pid, signal.SIGHUP)
        wait_for(lambda: "reloaded\n" in events.read_text())
        os.kill(pid, signal.SIGUSR1)
        process.communicate(timeout=5)
        assert "shutdown\n" in events.read_text()
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
print("isolated tmpfs switch-root and PID-1 sysinit/wait/respawn/CAD/reload/shutdown checks passed")
