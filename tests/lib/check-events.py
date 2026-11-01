"""ACPI proc/evdev fixtures and optional isolated-kernel link-change actions."""
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import tempfile
import time

binary = str(Path(sys.argv[1]).resolve())


def run(*args, status=0, env=None):
    result = subprocess.run([binary, *args], env=env, capture_output=True, timeout=8)
    assert result.returncode == status, (args, result)
    return result


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    config = root / "events"
    config.mkdir()
    marker = root / "actions"
    (config / "power").write_text(f"event=^button/power.*\naction=printf '%s\\n' %e >> '{marker}'\n")
    source = root / "proc-event"
    source.write_text("button/power PBTN 00000080 00000000\nbutton/sleep SBTN 00000080 00000000\n")
    run("acpid", "-d", "-c", str(config), "-e", str(source))
    assert marker.read_text().splitlines() == ["button/power PBTN 00000080 00000000"]
    evdev = root / "input-event"
    evdev.write_bytes(struct.pack("<qqHHi", 0, 0, 1, 116, 1) + struct.pack("<qqHHi", 0, 0, 1, 116, 0))
    run("acpid", "-d", "-c", str(config), str(evdev))
    assert len(marker.read_text().splitlines()) == 2
    run("ifplugd", "-i", "no-such-device", "-n", status=1)
    if "--namespace" in sys.argv:
        assert os.geteuid() == 0
        for namespace in ("net", "mnt"):
            assert os.readlink(f"/proc/self/ns/{namespace}") != os.readlink(f"/proc/1/ns/{namespace}")
        assert [line.split(":")[0].strip() for line in Path("/proc/net/dev").read_text().splitlines()[2:]] == ["lo"]
        subprocess.run(["mount", "--make-rprivate", "/"], check=True)
        subprocess.run(["mount", "-t", "sysfs", "sysfs", "/sys"], check=True)
        run("ip", "link", "add", "devlink0", "type", "dummy")
        script = root / "action"
        changes = root / "changes"
        script.write_text(f'#!/bin/sh\nprintf "%s %s %s\\n" "$1" "$2" "$3" >> "{changes}"\n')
        script.chmod(0o755)
        env = {**os.environ, "BUSYBOX_RUN": str(root)}
        process = subprocess.Popen([binary, "ifplugd", "-n", "-a", "-p", "-q", "-i", "devlink0",
                                    "-t", "1", "-u", "0", "-d", "0", "-r", str(script), "-x", "extra"],
                                   env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        def wait_for(predicate):
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if predicate():
                    return
                assert process.poll() is None, process.communicate()
                time.sleep(.05)
            raise AssertionError("link monitor did not produce expected state")

        try:
            pidfile = root / "ifplugd.devlink0.pid"
            wait_for(pidfile.exists)
            time.sleep(.15)
            run("ip", "link", "set", "devlink0", "up")
            wait_for(lambda: changes.exists() and "devlink0 up extra" in changes.read_text())
            run("ip", "link", "set", "devlink0", "down")
            wait_for(lambda: "devlink0 down extra" in changes.read_text())
            run("ifplugd", "-k", "-i", "devlink0", env=env)
            assert process.wait(timeout=3) == 0, process.communicate()
            assert not pidfile.exists()
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
print("ACPI text/evdev dispatch checks passed" + ("; isolated link action/PID cleanup checks passed" if "--namespace" in sys.argv else ""))
