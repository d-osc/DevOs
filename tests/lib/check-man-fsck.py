"""Manual lookup/formatter and fsck checker dispatch against controlled helpers."""
import gzip
import os
from pathlib import Path
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    commands = root / "bin"
    commands.mkdir()
    (commands / "mandoc").write_text("#!/bin/sh\nexec /bin/cat\n")
    (commands / "fsck.demo").write_text("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$CHECKER_LOG\"\nexit 4\n")
    for path in commands.iterdir():
        path.chmod(0o755)
    manual = root / "manual"
    (manual / "man1").mkdir(parents=True)
    (manual / "man5").mkdir()
    page = b'.TH DEMO 1\n.SH NAME\ndemo - a test\n'
    (manual / "man1/demo.1.gz").write_bytes(gzip.compress(page))
    (manual / "man5/demo.5").write_bytes(page.replace(b"DEMO 1", b"DEMO 5"))
    log = root / "calls"
    env = {**os.environ, "PATH": str(commands), "MANPATH": str(manual), "CHECKER_LOG": str(log)}

    def run(*args, status=0):
        result = subprocess.run([binary, *args], env=env, capture_output=True, timeout=5)
        assert result.returncode == status, (args, result)
        return result.stdout

    assert run("man", "-w", "demo") == str(manual / "man1/demo.1.gz").encode() + b"\n"
    assert len(run("man", "-aw", "demo").splitlines()) == 2
    assert run("man", "demo") == page
    assert b"DEMO 5" in run("man", "5", "demo")
    run("man", "missing", status=1)
    volume = root / "volume"
    volume.write_bytes(bytes(4096))
    assert run("fsck", "-NT", "-t", "demo", str(volume)) == f"fsck.demo {volume}\n".encode()
    assert not log.exists()
    run("fsck", "-T", "-t", "demo", "-n", str(volume), status=4)
    assert log.read_text().splitlines() == ["-n", str(volume)]
    run("fsck", "-T", "-t", "no-such-checker", str(volume), status=8)
    run("fsck", "-T", str(volume), status=8)
print("man discovery/gzip/formatter and fsck dry-run/status/dispatch checks passed")
