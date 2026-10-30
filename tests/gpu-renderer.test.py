"""Exercise session renderer selection with mocked compositor/device tools."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class RendererTests(unittest.TestCase):
    def run_session(self, renderer="auto", accelerated="no", mode="--nested"):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            tools = {
                "d": "echo /tmp/devos-renderer-test-config",
                "dbus-run-session": 'shift; exec "$@"',
                "labwc": 'printf "RESULT:%s:%s:%s\\n" "${WLR_RENDERER:-auto}" "${LIBGL_ALWAYS_SOFTWARE:-unset}" "${WLR_BACKENDS:-unset}"',
                "glxinfo": 'echo "Accelerated: $TEST_ACCELERATED"',
            }
            for name, body in tools.items():
                tool = work / name
                tool.write_text("#!/bin/sh\n" + body + "\n")
                tool.chmod(0o755)
            env = {key: value for key, value in os.environ.items()
                   if not key.startswith(("WLR_", "DEV_OS_", "LIBGL_", "WEBKIT_"))}
            env.update(PATH=str(work) + ":/usr/bin:/bin", XDG_RUNTIME_DIR=directory,
                       DEV_OS_SKIP_DOCTOR="1", DEV_OS_RENDERER=renderer,
                       WSL_DISTRO_NAME="test", WAYLAND_DISPLAY="test-wayland",
                       TEST_ACCELERATED=accelerated)
            # Explicit GPU mode must override inherited software flags.
            if renderer == "gles2":
                env["LIBGL_ALWAYS_SOFTWARE"] = "1"
            return subprocess.run(["sh", str(ROOT / "bin/dev-os-session"), mode],
                                  env=env, capture_output=True, text=True, timeout=15)

    def test_wsl_software_driver(self):
        result = self.run_session()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RESULT:pixman:1:wayland", result.stdout)

    def test_wsl_accelerated_driver(self):
        result = self.run_session(accelerated="yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RESULT:gles2:unset:wayland", result.stdout)

    def test_explicit_gpu_clears_software_flag(self):
        result = self.run_session(renderer="gles2")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RESULT:gles2:unset:wayland", result.stdout)

    def test_headless_keeps_software(self):
        result = self.run_session(renderer="gles2", mode="--headless")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RESULT:pixman:", result.stdout)
        self.assertIn(":headless", result.stdout)

    def test_invalid_renderer(self):
        result = self.run_session(renderer="invalid")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unsupported renderer", result.stderr)

if __name__ == "__main__":
    unittest.main()
