#!/usr/bin/env python3
"""Check real compositor app icons and window menus in a private headless session."""
import os
import select
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path

from PIL import Image
from smoke import ROOT, wait_for


screens = ROOT / "build/screenshots-app-icons"
screens.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="dev-os-app-icons-") as temporary:
    base = Path(temporary)
    runtime = base / "runtime"
    runtime.mkdir(mode=0o700)
    config = base / "config"
    config.mkdir()
    data = base / "data"
    (data / "applications").mkdir(parents=True)
    icon = data / "app.png"
    Image.new("RGBA", (16, 16), (240, 70, 50, 255)).save(icon)
    (data / "applications/org.devos.IconFixture.desktop").write_text(
        f"[Desktop Entry]\nType=Application\nName=Icon Fixture\nExec=foot\n"
        f"Icon={icon}\nStartupWMClass=dev-os-icon-alias\n")
    env = os.environ | {
        "XDG_RUNTIME_DIR": str(runtime), "XDG_CONFIG_HOME": str(config),
        "XDG_DATA_DIRS": f"{data}:/usr/local/share:/usr/share",
        "WLR_HEADLESS_OUTPUTS": "1", "GTK_USE_PORTAL": "0",
    }
    pointer = None
    clients = []
    with (screens / "session.log").open("w") as log:
        session = subprocess.Popen([str(ROOT / "bin/dev-os-session"), "--headless"],
            env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            wait_for(lambda: "Dev OS shell ready" in (screens / "session.log").read_text())
            env |= {"WAYLAND_DISPLAY": next(path.name for path in runtime.glob("wayland-*") if path.is_socket()),
                "GDK_BACKEND": "wayland"}
            pointer = subprocess.Popen(["dev-os-test-pointer-session"], env=env,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

            def move(*args):
                pointer.stdin.write(" ".join(args) + "\n")
                pointer.stdin.flush()
                assert select.select([pointer.stdout], [], [], 5)[0]
                assert pointer.stdout.readline().strip() == "ok"

            def click(x, y, button="left"):
                move("move", "-10000", "-10000")
                move("move", str(x), str(y))
                time.sleep(.15)
                move("click", button)

            def window(action, title, *args):
                return subprocess.run(["dev-os-test-pointer", "window", action,
                    "title:" + title, *args], env=env, capture_output=True, text=True)

            icons = {}
            for app_id in ("foot", "org.devos.IconFixture", "dev-os-icon-alias", "dev-os-no-icon"):
                title = "Icon smoke " + app_id
                client = subprocess.Popen(["foot", "--app-id=" + app_id, "--title=" + title,
                    "sh", "-c", "sleep 120"], env=env, stdout=log, stderr=log)
                clients.append(client)
                wait_for(lambda: window("find", title).returncode == 0)
                assert window("maximize", title).returncode == 0
                assert window("focus", title).returncode == 0
                time.sleep(.5)
                move("move", "-10000", "-10000")
                move("move", "1000", "600")
                path = screens / f"{app_id}.png"
                subprocess.run(["grim", str(path)], env=env, check=True)
                icons[app_id] = Image.open(path).convert("RGB").crop((3, 3, 23, 26))
                pixels = list(icons[app_id].getdata())
                if app_id in ("org.devos.IconFixture", "dev-os-icon-alias"):
                    assert sum(r > 200 and g < 100 and b < 100 for r, g, b in pixels) >= 100, \
                        "Header must display the icon declared in the app's .desktop file"
                else:
                    assert len(set(pixels)) > 10, "Header must show an icon rather than the old flat dot"
                # The icon is still a menu button. Choose Minimize from its actual menu.
                click(13, 12)
                time.sleep(.15)
                subprocess.run(["wtype", "-k", "Down", "-k", "Return"], env=env, check=True)
                wait_for(lambda: window("find", title, "state:minimized").returncode == 0)
                assert window("focus", title).returncode == 0
                wait_for(lambda: window("find", title, "state:activated").returncode == 0)
                click(500, 12, "right")
                time.sleep(.15)
                subprocess.run(["wtype", "-k", "Down", "-k", "Return"], env=env, check=True)
                wait_for(lambda: window("find", title, "state:minimized").returncode == 0)
                client.terminate()
                client.wait(timeout=5)
                print(f"PASS: {app_id} icon, icon menu and header right-click", flush=True)
            assert icons["foot"].tobytes() != icons["dev-os-no-icon"].tobytes(), \
                "Known applications must use their own icon instead of the generic fallback"
            assert "CRITICAL" not in (screens / "session.log").read_text()
        finally:
            for client in clients:
                if client.poll() is None:
                    client.terminate()
                    client.wait(timeout=5)
            if pointer:
                pointer.stdin.close()
                try:
                    pointer.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    pointer.kill()
                    pointer.wait()
            if session.poll() is None:
                os.killpg(session.pid, signal.SIGTERM)
                try:
                    session.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(session.pid, signal.SIGKILL)
                    session.wait()
            fusermount = shutil.which("fusermount3") or shutil.which("fusermount")
            if fusermount:
                subprocess.run([fusermount, "-uz", str(runtime / "doc")], capture_output=True, timeout=5)
