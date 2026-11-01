"""Check replay delay scaling and binary streaming across buffer boundaries."""
import pathlib
import subprocess
import sys
import tempfile
import time

binary = str(pathlib.Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    payload = bytes(range(256)) * 100
    (root / "typescript").write_bytes(payload + b"TRAILER")
    (root / "timing").write_text(f"0.4 3\n0 {len(payload) - 3}\n")
    start = time.monotonic()
    result = subprocess.run(
        [binary, "scriptreplay", "timing", "typescript", "2"],
        cwd=root, capture_output=True, timeout=10,
    )
    elapsed = time.monotonic() - start
    assert result.returncode == 0 and result.stdout == payload, result
    assert 0.17 <= elapsed < 5, elapsed
    (root / "timing").write_text(f"0 {len(payload) + 100}\n")
    result = subprocess.run(
        [binary, "scriptreplay", "timing"],
        cwd=root, capture_output=True, timeout=10,
    )
    assert result.returncode == 1 and b"shorter" in result.stderr, result
print("scriptreplay binary streaming, delay and truncation checks passed")
