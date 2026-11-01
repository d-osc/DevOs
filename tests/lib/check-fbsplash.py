"""Real mmap of a temporary file with Linux framebuffer geometry fixtures."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    library = root / "ioctl.so"
    subprocess.run(["cc", "-shared", "-fPIC", "-Wall", "-Wextra", "-Werror",
                    str(Path(__file__).with_name("console-ioctl-fixture.c")), "-ldl", "-o", str(library)], check=True)
    framebuffer = root / "framebuffer"
    framebuffer.write_bytes(bytes(64))
    image = root / "image.ppm"
    image.write_bytes(b"P6\n# comment\n2 2\n255\n" + bytes((255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255)))
    config = root / "config"
    config.write_text("BAR_LEFT=0\nBAR_TOP=0\nBAR_WIDTH=4\nBAR_HEIGHT=1\nBAR_R=0\nBAR_G=255\nBAR_B=0\n")
    control = root / "control"
    control.write_text("50\nexit\n")
    env = {**os.environ, "LD_PRELOAD": str(library), "IOCTL_LOG": str(root / "calls"), "FB_IMAGE_TEST": "1"}
    result = subprocess.run([binary, "fbsplash", "-s", str(image), "-d", str(framebuffer),
                             "-i", str(config), "-f", str(control)], env=env, capture_output=True, timeout=5)
    assert result.returncode == 0, result
    data = framebuffer.read_bytes()
    assert data[:16] == bytes((0, 255, 0, 255)) * 2 + bytes(8), data
    assert data[20:28] == bytes((0, 0, 255, 255, 0, 255, 0, 255)), data
    assert data[36:44] == bytes((255, 0, 0, 255, 255, 255, 255, 255)), data
    image.write_bytes(b"P6 2 2 255\ntruncated")
    result = subprocess.run([binary, "fbsplash", "-s", str(image), "-d", str(framebuffer)], env=env, capture_output=True, timeout=5)
    assert result.returncode == 1 and framebuffer.read_bytes() == data, result
print("framebuffer PPM decode/centering/RGB packing/progress and invalid-image checks passed")
