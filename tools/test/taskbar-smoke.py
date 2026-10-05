#!/usr/bin/env python3
"""Exercise native minimize buttons and taskbar restores in an isolated compositor."""
import os
import select
import signal
import subprocess
import tempfile
import time
import shutil
from pathlib import Path
from smoke import ROOT, wait_for
from smoke_support import cleanup_session

screens = ROOT / "build/screenshots-taskbar-focused"
screens.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="dev-os-taskbar-") as temporary:
    base = Path(temporary)
    runtime = base / "runtime"; runtime.mkdir(mode=0o700)
    config = base / "config"; config.mkdir()
    env = os.environ | {"XDG_RUNTIME_DIR": str(runtime), "XDG_CONFIG_HOME": str(config),
        "WLR_HEADLESS_OUTPUTS": "1", "GTK_USE_PORTAL": "0"}
    pointer = None
    with (screens / "session.log").open("w") as log:
        session = subprocess.Popen([str(ROOT / "bin/dev-os-session"), "--headless"], env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            wait_for(lambda: "Dev OS shell ready" in (screens / "session.log").read_text())
            shell = next(process for process in Path("/proc").iterdir() if process.name.isdecimal()
                and (process / "cmdline").exists() and str(ROOT / "dist/main.js").encode() in (process / "cmdline").read_bytes().split(b"\0")
                and f"XDG_RUNTIME_DIR={runtime}".encode() in (process / "environ").read_bytes().split(b"\0"))
            shell_env = dict(item.decode().split("=", 1) for item in (shell / "environ").read_bytes().split(b"\0") if b"=" in item)
            env |= {"WAYLAND_DISPLAY": next(path.name for path in runtime.glob("wayland-*") if path.is_socket()),
                "DBUS_SESSION_BUS_ADDRESS": shell_env["DBUS_SESSION_BUS_ADDRESS"], "GDK_BACKEND": "wayland"}
            pointer = subprocess.Popen(["dev-os-test-pointer-session"], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            def move(*args):
                pointer.stdin.write(" ".join(args) + "\n"); pointer.stdin.flush()
                assert select.select([pointer.stdout], [], [], 5)[0]
                assert pointer.stdout.readline().strip() == "ok"
            def click(x, y):
                move("move", "-10000", "-10000"); move("move", str(x), str(y)); time.sleep(.2); move("click", "left")
            def windows():
                return subprocess.run(["dev-os-test-pointer", "window", "list"], env=env, capture_output=True, text=True, check=True).stdout
            def state(title, value):
                return subprocess.run(["dev-os-test-pointer", "window", "find", "title:" + title, "state:" + value], env=env, capture_output=True).returncode == 0
            for command, label, x in [("files", "Dev OS Files", 82), ("terminal", "Dev OS Terminal", 50)]:
                subprocess.run([str(ROOT / "bin/dev-os-shell"), command], env=env, check=True)
                wait_for(lambda: label in windows()); time.sleep(.6)
                title = next(line.split(": ", 1)[1] for line in windows().splitlines() if label in line)
                subprocess.run(["dev-os-test-pointer", "window", "maximize", "title:" + title], env=env, check=True)
                subprocess.run(["dev-os-test-pointer", "window", "focus", "title:" + title], env=env, check=True)
                wait_for(lambda: state(title, "activated"))
                time.sleep(.3)
                click(1196, 16); wait_for(lambda: state(title, "minimized"))
                subprocess.run(["grim", str(screens / f"{command}-minimized.png")], env=env, check=True)
                click(x, 702); wait_for(lambda: state(title, "activated"))
                assert windows().count(label) == 1, "Restore must not create another window"
                subprocess.run(["grim", str(screens / f"{command}-restored.png")], env=env, check=True)
                click(x, 702); wait_for(lambda: state(title, "minimized"))
                click(x, 702); wait_for(lambda: state(title, "activated"))
                print(f"PASS: {label} native minimize, panel restore and active toggle", flush=True)
            subprocess.run([str(ROOT / "bin/dev-os-shell"), "terminal"], env=env, check=True)
            wait_for(lambda: windows().count("Dev OS Terminal") == 2); time.sleep(.5)
            click(50, 702)
            subprocess.run(["grim", str(screens / "terminal-window-picker.png")], env=env, check=True)
            # Select the first window in the popup above the 36 px panel.
            click(100, 534); time.sleep(.3)
            assert windows().count("Dev OS Terminal") == 2, "Window picker must not launch another shell"
            print("PASS: grouped Terminal windows offer a taskbar picker", flush=True)
        except Exception:
            if pointer:
                subprocess.run(["grim", str(screens / "failure.png")], env=env, capture_output=True)
            raise
        finally:
            cleanup_session(session, pointer, runtime / 'doc')
