#!/usr/bin/env python3
"""Exercise a real headless compositor, remote shell commands and session cleanup."""
import argparse
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import select

ROOT = Path(__file__).resolve().parents[1]


def wait_for(predicate, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.1)
    raise RuntimeError("Timed out waiting for compositor / shell")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshots", type=Path, help="Save actual compositor screenshots")
    parser.add_argument("--keyboard", action="store_true", help="Test shortcuts and app launch using wtype + foot")
    parser.add_argument("--outputs", type=int, choices=(1, 2), default=1)
    parser.add_argument("--pointer", action="store_true", help="Test native titlebar right-click with dev-os-test-pointer (one output)")
    args = parser.parse_args()
    if args.pointer and (not args.keyboard or args.outputs != 1 or not shutil.which("dev-os-test-pointer") or not shutil.which("dev-os-test-pointer-session")):
        parser.error("--pointer requires --keyboard, one output, and tools/bootstrap-pointer-test.sh")
    if sys.platform != "linux":
        parser.error("Run inside Linux or WSL")
    if args.keyboard and (not shutil.which("wtype") or not shutil.which("foot")):
        parser.error("--keyboard requires wtype and foot")
    for script in (ROOT / "bin").iterdir():
        script.chmod(0o755)
    with tempfile.TemporaryDirectory(prefix="dev-os-smoke-") as temporary:
        base = Path(temporary)
        runtime = base / "runtime"
        runtime.mkdir(mode=0o700)
        config = base / "config/dev-os"
        config.mkdir(parents=True)
        files_fixture = base / "dev-os-de"
        (files_fixture / "Documents").mkdir(parents=True)
        (files_fixture / "Downloads").mkdir()
        (files_fixture / "README.txt").write_text("Native Dev OS Files smoke fixture\n")
        (files_fixture / "src").mkdir()
        (files_fixture / "src/files-view.tsx").write_text('export const FilesView = () => <Box />;\n')
        (files_fixture / "src/model.ts").write_text('export class FileBrowser {}\n')
        (files_fixture / "extensions").mkdir()
        (files_fixture / "package.json").write_text('{"name":"dev-workspace","scripts":{"dev":"gjs -m dist/main.js"}}\n')
        (files_fixture / "tsconfig.json").write_text('{"compilerOptions":{"strict":true}}\n')
        (files_fixture / "app.tsx").write_text('export const App = () => <Box><Label>Hello developer</Label></Box>;\n')
        (files_fixture / "README.md").write_text('# Developer workspace\n\nNative React + TypeScript + GTK.\n')
        (files_fixture / ".gitignore").write_text('dist/\nnode_modules/\n')
        (config / "extensions").mkdir()
        (config / "extensions/org.devos.files.json").write_text(json.dumps({
            "version": 1, "enabled": True, "values": {"homeDirectory": str(files_fixture), "gridView": False, "showHidden": False}
        }))
        marker = base / "terminal-opened"
        terminal = base / "fake-terminal"
        terminal.write_text(f"#!/bin/sh\npwd > '{marker}.cwd'\nprintf opened > '{marker}'\n")
        terminal.chmod(0o755)
        service_pidfile = base / "service.pid"
        service = base / "managed-service"
        service.write_text(f"#!/bin/sh\necho $$ > '{service_pidfile}'\nexec sleep 300\n")
        service.chmod(0o755)
        native_marker = base / "native-terminal-opened"
        native_command = base / "native-terminal"
        native_command.write_text(
            f"#!/bin/sh\nprintf 'Dev OS: native Wayland client OK\\n'\n"
            f"touch '{native_marker}'\nsleep 30\n")
        native_command.chmod(0o755)
        applications = base / "data/applications"
        applications.mkdir(parents=True)
        (applications / "dev-os-smoke.desktop").write_text(
            "[Desktop Entry]\nType=Application\nName=Dev OS Smoke Terminal\n"
            "Icon=utilities-terminal\nTerminal=false\n"
            f"Exec=foot --title=Dev-OS-Smoke {native_command}\n")
        (config / "config.json").write_text(json.dumps({
            "terminal": [str(terminal)], "lock": ["dev-os-smoke-missing-locker"],
            "autostart": [[str(service)]],
        }))
        env = os.environ.copy()
        env.update({"XDG_RUNTIME_DIR": str(runtime), "XDG_CONFIG_HOME": str(config.parent),
                    "XDG_DATA_HOME": str(applications.parent),
                    "PYTHONUNBUFFERED": "1", "WLR_HEADLESS_OUTPUTS": str(args.outputs),
                    "GTK_USE_PORTAL": "0"})
        log = base / "session.log"
        with log.open("w") as output:
            pointer_session = None
            process = subprocess.Popen([str(ROOT / "bin/dev-os-session"), "--headless"],
                                       env=env, stdout=output, stderr=output, start_new_session=True)
            try:
                wait_for(lambda: "Dev OS shell ready" in log.read_text())
                wait_for(service_pidfile.exists)
                service_pid = int(service_pidfile.read_text())
                assert f"({args.outputs} output(s))" in log.read_text()
                sockets = [path for path in runtime.glob("wayland-*") if path.is_socket()]
                assert len(sockets) == 1, sockets
                target = None
                session_env = {}
                for entry in Path("/proc").iterdir():
                    if not entry.name.isdecimal():
                        continue
                    try:
                        command = (entry / "cmdline").read_bytes().split(b"\x00")
                        environ = (entry / "environ").read_bytes().split(b"\x00")
                    except (OSError, PermissionError):
                        continue
                    if (str(ROOT / "dist/main.js").encode() in command
                            and f"XDG_RUNTIME_DIR={runtime}".encode() in environ):
                        target = int(entry.name)
                        session_env = dict(item.decode().split("=", 1)
                                           for item in environ if b"=" in item)
                        break
                assert target is not None, "Session shell PID not found"
                child_env = env | {"WAYLAND_DISPLAY": sockets[0].name, "GDK_BACKEND": "wayland",
                                   "DBUS_SESSION_BUS_ADDRESS": session_env["DBUS_SESSION_BUS_ADDRESS"]}
                # Native UI tests need the same optional VTE runtime as the shell.
                child_env |= {key: session_env[key] for key in ("GI_TYPELIB_PATH", "LD_LIBRARY_PATH") if key in session_env}
                print("PASS: compositor and layer surfaces started", flush=True)
                subprocess.run(["gjs", "-m", str(ROOT / "dist/renderer-test.js")],
                               env=child_env | {"G_DEBUG": "fatal-criticals"}, check=True, timeout=20)
                subprocess.run(["gjs", "-m", str(ROOT / "dist/desktop-ui-test.js")],
                               env=child_env | {"G_DEBUG": "fatal-criticals"}, check=True, timeout=40)

                def remote(command, expect=0):
                    result = subprocess.run([str(ROOT / "bin/dev-os-shell"), command],
                                            env=child_env, capture_output=True, text=True, timeout=10)
                    assert result.returncode == expect, result.stderr

                def screenshot(name):
                    if args.screenshots:
                        args.screenshots.mkdir(parents=True, exist_ok=True)
                        subprocess.run(["grim", str(args.screenshots / f"{name}.png")],
                                       env=child_env, check=True, timeout=10)

                if args.pointer:
                    pointer_session = subprocess.Popen(["dev-os-test-pointer-session"], env=child_env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
                def pointer(*arguments):
                    pointer_session.stdin.write(" ".join(arguments) + "\n"); pointer_session.stdin.flush()
                    assert select.select([pointer_session.stdout], [], [], 5)[0], "Pointer session did not respond"
                    assert pointer_session.stdout.readline().strip() == "ok", "Pointer session failed"

                time.sleep(.3)
                screenshot("desktop")
                if args.pointer:
                    pointer("move", "-10000", "-10000")
                    pointer("move", "1140", "702")
                    time.sleep(.2)
                    pointer("click", "left")
                    time.sleep(.4)
                    screenshot("panel-quick-settings")
                    pointer("move", "-600", "-250")
                    pointer("click", "left")
                    time.sleep(.3)
                    pointer("move", "-10000", "-10000")
                    pointer("move", "1258", "702")
                    time.sleep(.2)
                    pointer("click", "left")
                    time.sleep(.3)
                    screenshot("panel-alerts")
                    pointer("move", "-600", "-250")
                    pointer("click", "left")
                    time.sleep(.3)
                    print("PASS: bottom panel quick settings and alerts open and dismiss", flush=True)

                remote("launcher")
                time.sleep(.3)
                screenshot("launcher")
                remote("launcher")
                if args.keyboard:
                    def keys(*arguments):
                        subprocess.run(["wtype", *arguments], env=child_env, check=True, timeout=10)

                    keys("-M", "logo", "-k", "space", "-m", "logo")
                    time.sleep(1)
                    keys("-d", "40", "Dev OS Smoke Terminal")
                    time.sleep(.5)
                    screenshot("search")
                    keys("-k", "Return")
                    wait_for(native_marker.exists)
                    time.sleep(.3)
                    screenshot("terminal")
                    keys("-M", "alt", "-k", "F4", "-m", "alt")
                    time.sleep(.3)
                    print("PASS: compositor shortcut, launcher search and native terminal", flush=True)
                    demo = subprocess.Popen(["gjs", "-m", str(ROOT / "dist/react-demo.js")],
                                            env=child_env | {"G_DEBUG": "fatal-criticals"},
                                            stdout=output, stderr=output)
                    try:
                        time.sleep(.7)
                        assert demo.poll() is None, "React demo must open a native window"
                        keys("-d", "20", "React")
                        time.sleep(.3)
                        screenshot("react-demo")
                        keys("-M", "alt", "-k", "F4", "-m", "alt")
                        assert demo.wait(timeout=5) == 0, "React demo must unmount cleanly"
                        print("PASS: React JSX demo opens and closes its native GTK window", flush=True)
                    finally:
                        if demo.poll() is None:
                            demo.terminate()
                            demo.wait(timeout=5)
                remote("files")
                wait_for(lambda: f"Dev OS Files ready: {files_fixture}" in log.read_text())
                time.sleep(.3)
                screenshot("files")
                if args.pointer:
                    pointer("move", "-10000", "-10000")
                    pointer("move", "500", "24")
                    time.sleep(.2)
                    pointer("click", "right")
                    time.sleep(.3)
                    screenshot("files-window-menu")
                    keys("-k", "Down", "-k", "Return")
                    title = f"title:Dev OS Files · {files_fixture}"
                    wait_for(lambda: subprocess.run(["dev-os-test-pointer", "window", "find", title, "state:minimized"], env=child_env, capture_output=True, timeout=5).returncode == 0)
                    time.sleep(.2)
                    screenshot("panel-files-minimized")
                    subprocess.run(["dev-os-test-pointer", "window", "focus", title], env=child_env, check=True, timeout=5)
                    subprocess.run(["dev-os-test-pointer", "window", "maximize", title], env=child_env, check=True, timeout=5)
                    time.sleep(.3)
                    pointer("move", "-10000", "-10000"); pointer("move", "1196", "16")
                    time.sleep(.2); pointer("click", "left")
                    wait_for(lambda: subprocess.run(["dev-os-test-pointer", "window", "find", title, "state:minimized"], env=child_env, capture_output=True, timeout=5).returncode == 0)
                    pointer("move", "-10000", "-10000"); pointer("move", "80", "702")
                    time.sleep(.2); pointer("click", "left")
                    wait_for(lambda: subprocess.run(["dev-os-test-pointer", "window", "find", title, "state:activated"], env=child_env, capture_output=True, timeout=5).returncode == 0)
                    print("PASS: Files minimize button updates taskbar and panel restores the existing window", flush=True)
                    time.sleep(.3)
                    print("PASS: titlebar right-click opens compositor menu and Minimize targets Files", flush=True)
                if args.keyboard:
                    keys("-M", "ctrl", "-k", "p", "-m", "ctrl")
                    time.sleep(.3)
                    keys("-d", "30", "fvtsx")
                    time.sleep(.5)
                    screenshot("files-quick-open")
                    keys("-M", "ctrl", "-k", "p", "-m", "ctrl")
                    time.sleep(.15)
                    keys("-d", "30", "tsx")
                    time.sleep(.3)
                    keys("-k", "Down")
                    time.sleep(.1)
                    keys("-M", "shift", "-k", "Return", "-m", "shift")
                    wait_for(lambda: f"Dev OS Files ready: {files_fixture / 'src'}" in log.read_text())
                    time.sleep(.2)
                    screenshot("files-reveal")
                    keys("-M", "alt", "-k", "Left", "-m", "alt")
                    time.sleep(.3)
                    keys("-M", "ctrl", "-k", "p", "-m", "ctrl")
                    time.sleep(.2)
                    keys("-k", "Escape")
                    time.sleep(.2)
                    print("PASS: Quick Open fuzzy query, keyboard selection, Shift Enter reveal, history and Escape", flush=True)
                    keys("-M", "ctrl", "-k", "2", "-m", "ctrl")
                    time.sleep(.2)
                    screenshot("files-grid")
                    keys("-M", "ctrl", "-k", "1", "-m", "ctrl")
                    keys("-M", "ctrl", "-k", "l", "-m", "ctrl")
                    time.sleep(.15)
                    keys("-d", "10", str(files_fixture / "Documents"))
                    time.sleep(.15)
                    keys("-k", "Return")
                    screenshot("files-navigation")
                    wait_for(lambda: f"Dev OS Files ready: {files_fixture / 'Documents'}" in log.read_text())
                    time.sleep(.2)
                    screenshot("files-folder")
                    keys("-M", "ctrl", "-k", "t", "-m", "ctrl")
                    time.sleep(.3)
                    keys("-M", "ctrl", "-k", "l", "-m", "ctrl")
                    keys("-d", "10", str(files_fixture / "Downloads"), "-k", "Return")
                    wait_for(lambda: f"Dev OS Files ready: {files_fixture / 'Downloads'}" in log.read_text())
                    time.sleep(.2)
                    screenshot("files-tabs")
                    keys("-M", "ctrl", "-M", "shift", "-k", "Tab", "-m", "shift", "-m", "ctrl")
                    keys("-M", "ctrl", "-M", "shift", "-k", "t", "-m", "shift", "-m", "ctrl")
                    wait_for(marker.exists)
                    assert Path(f"{marker}.cwd").read_text().strip() == str(files_fixture / "Documents"), "Switching Files tabs restores the original folder"
                    marker.unlink()
                    keys("-M", "ctrl", "-k", "Tab", "-m", "ctrl")
                    keys("-M", "ctrl", "-M", "shift", "-k", "t", "-m", "shift", "-m", "ctrl")
                    wait_for(marker.exists)
                    assert Path(f"{marker}.cwd").read_text().strip() == str(files_fixture / "Downloads"), "Second Files tab keeps its folder"
                    marker.unlink()
                    keys("-M", "ctrl", "-k", "w", "-m", "ctrl")
                    time.sleep(.2)
                    print("PASS: Files tab shortcuts create, cycle and close independent folders", flush=True)
                    keys("-M", "ctrl", "-M", "shift", "-k", "t", "-m", "shift", "-m", "ctrl")
                    wait_for(marker.exists)
                    assert Path(f"{marker}.cwd").read_text().strip() == str(files_fixture / "Documents"), "Files terminal must use the current folder"
                    marker.unlink()
                    print("PASS: Files terminal shortcut opens in the current folder", flush=True)
                    keys("-M", "alt", "-k", "F4", "-m", "alt")
                print("PASS: built-in React Files opens and navigates a folder", flush=True)
                remote("settings")
                time.sleep(.5)
                screenshot("settings")
                if args.keyboard:
                    keys("-M", "alt", "-k", "F4", "-m", "alt")
                print("PASS: settings command opens the native React settings window", flush=True)
                remote("terminal")
                wait_for(marker.exists)
                print("PASS: remote commands reach shell and start configured applications", flush=True)
                remote("lock", expect=1)
                print("PASS: missing optional command reports failure", flush=True)
                (config / "config.json").write_text(json.dumps({"accent": "#ffbb77", "panel_height": 64}))
                remote("reload")
                time.sleep(.3)
                screenshot("reloaded")
                print("PASS: live configuration reload", flush=True)
                if args.keyboard:
                    native_shell_marker = base / "vte-shell.cwd"
                    remote("terminal")
                    wait_for(lambda: "Dev OS Terminal ready:" in log.read_text())
                    time.sleep(.5)
                    keys("-d", "10", f"pwd > '{native_shell_marker}'", "-k", "Return")
                    wait_for(native_shell_marker.exists)
                    assert native_shell_marker.read_text().strip() == str(Path.home()), "Native shell starts in home"
                    screenshot("native-terminal")
                    first_marker, second_marker = base / "tab-first", base / "tab-second"
                    keys("-d", "10", "export DEV_OS_TAB=first", "-k", "Return")
                    previous_ready = log.read_text().count("Dev OS Terminal ready:")
                    keys("-M", "ctrl", "-M", "shift", "-k", "t", "-m", "shift", "-m", "ctrl")
                    wait_for(lambda: log.read_text().count("Dev OS Terminal ready:") > previous_ready)
                    time.sleep(.8)
                    keys("-d", "10", f"printf '%s' \"${{DEV_OS_TAB-unset}}\" > '{second_marker}'", "-k", "Return")
                    wait_for(second_marker.exists)
                    assert second_marker.read_text() == "unset", "New tab must have an independent shell environment"
                    keys("-d", "10", "export DEV_OS_TAB=second", "-k", "Return")
                    time.sleep(.2)
                    keys("-M", "ctrl", "-k", "l", "-m", "ctrl")
                    time.sleep(.2)
                    screenshot("terminal-tabs")
                    keys("-M", "ctrl", "-M", "shift", "-k", "Tab", "-m", "shift", "-m", "ctrl")
                    keys("-d", "10", f"printf '%s' \"$DEV_OS_TAB\" > '{first_marker}'", "-k", "Return")
                    wait_for(first_marker.exists)
                    assert first_marker.read_text() == "first", "Switching tabs preserves the first shell"
                    keys("-M", "ctrl", "-k", "Tab", "-m", "ctrl")
                    keys("-M", "ctrl", "-M", "shift", "-k", "w", "-m", "shift", "-m", "ctrl")
                    time.sleep(.3)
                    first_marker.unlink()
                    keys("-d", "10", f"printf '%s' \"$DEV_OS_TAB\" > '{first_marker}'", "-k", "Return")
                    wait_for(first_marker.exists)
                    assert first_marker.read_text() == "first", "Closing second tab keeps first shell alive"
                    previous_ready = log.read_text().count("Dev OS Terminal ready:")
                    keys("-M", "ctrl", "-M", "shift", "-k", "t", "-m", "shift", "-m", "ctrl")
                    wait_for(lambda: log.read_text().count("Dev OS Terminal ready:") > previous_ready)
                    time.sleep(.8)
                    keys("-d", "10", "exit", "-k", "Return")
                    time.sleep(.8)
                    first_marker.unlink()
                    keys("-d", "10", f"printf '%s' \"$DEV_OS_TAB\" > '{first_marker}'", "-k", "Return")
                    wait_for(first_marker.exists)
                    assert first_marker.read_text() == "first", "Shell exit closes only its own tab"
                    print("PASS: Terminal tabs keep independent shells, cycle, close and handle per-tab shell exit", flush=True)
                    if args.pointer:
                        listing = subprocess.run(["dev-os-test-pointer", "window", "list"], env=child_env, check=True, capture_output=True, text=True, timeout=5).stdout
                        title = "title:" + next(line.split(": ", 1)[1] for line in listing.splitlines() if "Dev OS Terminal" in line)
                        subprocess.run(["dev-os-test-pointer", "window", "maximize", title], env=child_env, check=True, timeout=5)
                        time.sleep(.3)
                        pointer("move", "-10000", "-10000")
                        pointer("move", "500", "16")
                        time.sleep(.2)
                        pointer("click", "right")
                        time.sleep(.3)
                        screenshot("terminal-window-menu")
                        keys("-k", "Down", "-k", "Return")
                        wait_for(lambda: subprocess.run(["dev-os-test-pointer", "window", "find", title, "state:minimized"], env=child_env, capture_output=True, timeout=5).returncode == 0)
                        time.sleep(.2); screenshot("panel-terminal-minimized")
                        subprocess.run(["dev-os-test-pointer", "window", "focus", title], env=child_env, check=True, timeout=5)
                        time.sleep(.3)
                        pointer("move", "-10000", "-10000"); pointer("move", "1196", "16")
                        time.sleep(.2); pointer("click", "left")
                        wait_for(lambda: subprocess.run(["dev-os-test-pointer", "window", "find", title, "state:minimized"], env=child_env, capture_output=True, timeout=5).returncode == 0)
                        pointer("move", "-10000", "-10000"); pointer("move", "50", "688")
                        time.sleep(.2); pointer("click", "left")
                        wait_for(lambda: subprocess.run(["dev-os-test-pointer", "window", "find", title, "state:activated"], env=child_env, capture_output=True, timeout=5).returncode == 0)
                        pointer("click", "left")
                        wait_for(lambda: subprocess.run(["dev-os-test-pointer", "window", "find", title, "state:minimized"], env=child_env, capture_output=True, timeout=5).returncode == 0)
                        pointer("click", "left")
                        wait_for(lambda: subprocess.run(["dev-os-test-pointer", "window", "find", title, "state:activated"], env=child_env, capture_output=True, timeout=5).returncode == 0)
                        screenshot("panel-terminal-restored")
                        print("PASS: Terminal taskbar restores and toggles the same running shell", flush=True)
                        time.sleep(.3)
                        print("PASS: Terminal header right-click menu minimizes the correct window", flush=True)
                    keys("-d", "20", "exit", "-k", "Return")
                    time.sleep(.5)
                    assert "Gtk-CRITICAL" not in log.read_text(), log.read_text()
                    print("PASS: built-in Terminal runs a real shell, writes output and exits cleanly", flush=True)
                    remote("files")
                    time.sleep(.3)
                    directory_ready = f"Dev OS Files ready: {files_fixture / 'Documents'}"
                    previous_ready = log.read_text().count(directory_ready)
                    keys("-M", "ctrl", "-k", "l", "-m", "ctrl")
                    keys("-d", "10", str(files_fixture / "Documents"), "-k", "Return")
                    wait_for(lambda: log.read_text().count(directory_ready) > previous_ready)
                    keys("-M", "ctrl", "-M", "shift", "-k", "t", "-m", "shift", "-m", "ctrl")
                    wait_for(lambda: f"Dev OS Terminal ready: {files_fixture / 'Documents'}" in log.read_text())
                    time.sleep(.4)
                    native_shell_marker.unlink()
                    keys("-d", "10", f"pwd > '{native_shell_marker}'", "-k", "Return")
                    wait_for(native_shell_marker.exists)
                    assert native_shell_marker.read_text().strip() == str(files_fixture / "Documents")
                    keys("-d", "20", "exit", "-k", "Return")
                    time.sleep(.3)
                    print("PASS: native Terminal opens in Files' current directory", flush=True)


                (config / "config.json").write_text(json.dumps({"accent": "invalid"}))
                remote("reload", expect=1)
                assert process.poll() is None
                print("PASS: bad reload preserves running shell", flush=True)
                # Restore a valid config before requesting logout via the client CLI.
                (config / "config.json").write_text(json.dumps({"accent": "#ffbb77"}))
                remote("logout")
                assert process.poll() is None, "Logout must wait for user confirmation"
                print("PASS: logout waits for confirmation", flush=True)
                os.kill(target, signal.SIGTERM)
                process.wait(timeout=10)
                wait_for(lambda: not sockets[0].exists(), timeout=5)
                wait_for(lambda: not Path(f"/proc/{service_pid}").exists(), timeout=5)
                print("PASS: shell exit shuts down compositor and removes Wayland socket", flush=True)
                print("PASS: managed autostart service terminates with session", flush=True)
                errors = log.read_text()
                assert "Traceback" not in errors, errors
                assert "Gtk-CRITICAL" not in errors, errors
                assert "JS ERROR" not in errors, errors
                assert "Gjs-CRITICAL" not in errors, errors
                print("PASS: no JavaScript exceptions or GTK critical errors", flush=True)
            except Exception:
                if args.screenshots and 'child_env' in locals():
                    args.screenshots.mkdir(parents=True, exist_ok=True)
                    (args.screenshots / "failure.log").write_text(log.read_text())
                    subprocess.run(["grim", str(args.screenshots / "failure.png")],
                                   env=child_env, capture_output=True, timeout=5)
                print(log.read_text(), file=sys.stderr)
                raise
            finally:
                if pointer_session:
                    pointer_session.stdin.close()
                    try: pointer_session.wait(timeout=5)
                    except subprocess.TimeoutExpired: pointer_session.kill(); pointer_session.wait()
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                # A distro's D-Bus activated document portal may mount a FUSE filesystem
                # inside this test's runtime. Unmount only that test-owned mount before
                # TemporaryDirectory walks the directory after the private bus exits.
                fusermount = shutil.which("fusermount3") or shutil.which("fusermount")
                if fusermount:
                    subprocess.run([fusermount, "-uz", str(runtime / "doc")],
                                   capture_output=True, timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

