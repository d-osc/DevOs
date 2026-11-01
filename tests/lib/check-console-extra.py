"""Validate Linux UAPI request numbers and payloads without changing devices."""
import os
from pathlib import Path
import struct
import datetime
import pty
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    library = root / "ioctl.so"
    subprocess.run(["cc", "-shared", "-fPIC", "-Wall", "-Wextra", "-Werror",
                    str(Path(__file__).with_name("console-ioctl-fixture.c")),
                    "-ldl", "-o", str(library)], check=True)
    log = root / "calls"
    environment = {**os.environ, "LD_PRELOAD": str(library), "IOCTL_LOG": str(log)}

    def run(*args, data=b"", status=0, fail=False):
        env = {**environment, **({"IOCTL_FAIL": "1"} if fail else {})}
        result = subprocess.run([binary, *args], input=data, env=env,
                                capture_output=True, timeout=5)
        assert result.returncode == status, (args, result)
        return result.stdout

    dumped = run("dumpkmap")
    expected = b"bkeymap" + b"\1" + bytes(255) + struct.pack("<128H", *range(0x100, 0x180))
    assert dumped == expected
    before = log.read_text().count("4b47\n")
    run("loadkmap", data=dumped)
    assert log.read_text().count("4b47\n") - before == 128
    run("loadkmap", data=dumped[:-1], status=1)
    run("loadkmap", data=b"invalid", status=1)
    run("dumpkmap", status=1, fail=True)
    run("setkeycodes", "59", "120", "e01c", "96")
    run("setkeycodes", "zz", "12", status=1)
    run("setkeycodes", "59", "-1", status=1)
    raw = b"".join(bytes((i, 255 - i)) for i in range(256))
    psf1 = b"\x36\x04\x00\x02" + raw
    psf2 = struct.pack("<8I", 0x864AB572, 0, 32, 0, 256, 2, 2, 8) + raw
    for data in (raw, psf1, psf2):
        run("loadfont", data=data)
    run("loadfont", data=psf1[:-1], status=1)
    font = root / "font.psf"
    font.write_bytes(psf2)
    screenmap = root / "map"
    screenmap.write_bytes(bytes(range(256)))
    run("setfont", str(font), "-m", str(screenmap), "-C", "/dev/null")
    run("mt", "-f", "/dev/null", "fsf", "3")
    assert run("mt", "-f", "/dev/null", "tell") == b"1234\n"
    run("mt", "-f", "/dev/null", "nonsense", status=1)
    run("flash_lock", "/dev/null", "0x1000", "2")
    run("flash_lock", "/dev/null", "99", "-1")
    run("flash_unlock", "/dev/null")
    run("flash_lock", "/dev/null", "1", "2", status=1)
    run("flash_lock", "/dev/null", "0", "9999", status=1)
    run("flash_unlock", "/dev/null", status=1, fail=True)
    assert run("losetup", "-f") == b"/dev/loop7\n"
    backing = root / "backing"
    backing.write_bytes(bytes(8192))
    run("losetup", "-o", "4096", "/dev/loop7", str(backing))
    assert run("losetup", "/dev/loop7") == b"/dev/loop7: 4096 /tmp/backing\n"
    run("losetup", "-d", "/dev/loop7")
    run("losetup", "-d", "/dev/loop7", status=1, fail=True)
    assert b'geometry 640 480 640 480 32' in run("fbset", "-fb", "/dev/null")
    run("fbset", "-fb", "/dev/null", "-g", "800", "600", "800", "600", "16",
        "-t", "25000", "88", "40", "23", "1", "128", "4", "-hsync", "high")
    modes = root / "fb.modes"
    modes.write_text('mode "demo"\n geometry 800 600 800 600 16\n timings 25000 88 40 23 1 128 4\n hsync high\nendmode\n')
    run("fbset", "-fb", "/dev/null", "-db", str(modes), "demo")
    run("fbset", "-fb", "/dev/null", "-db", str(modes), "missing", status=1)
    run("fbset", "-fb", "/dev/null", "-g", "0", "0", "0", "0", "32", status=1)
    run("fbset", "-fb", "/dev/null", status=1, fail=True)
    marker = root / "child"
    run("openvt", "-sw", "sh", "-c", f"echo child > '{marker}'; exit 7", status=7)
    assert marker.read_text() == "child\n"
    run("openvt", "-c", "1", "true", status=1)
    run("openvt", "-c", "0", "true", status=1)
    run("fdformat", "-n", "/dev/null")
    assert log.read_text().count("400c0248\n") == 4
    run("fdformat", "-n", "/dev/null", status=1, fail=True)
    stamp = int(datetime.datetime(2030, 1, 2, 3, 4, 5, tzinfo=datetime.timezone.utc).timestamp())
    run("rtcwake", "-u", "-d", "/dev/null", "-m", "no", "-t", str(stamp))
    run("rtcwake", "-u", "-d", "/dev/null", "-m", "no", "-t", str(stamp), status=1, fail=True)
    master, slave = pty.openpty()
    try:
        run("slattach", "-e", "-L", "-F", "-p", "cslip", os.ttyname(slave))
    finally:
        os.close(master)
        os.close(slave)
    output = run("hdparm", "-c1", "-g", "-i", "-I", "-C", "-W1", "-B128", "-Xudma6", "/dev/null")
    assert b"TEST DEVICE" in output and b"geometry = 1024/16/63" in output and b"active/idle" in output
    run("hdparm", "-c", "/dev/null", status=1, fail=True)
    run("hdparm", "-W", "/dev/null", status=1)
print("console/keymap/font/tape/flash Linux UAPI fixture checks passed")
