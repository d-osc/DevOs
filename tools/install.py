#!/usr/bin/env python3
"""Install under a prefix; system session registration uses a system prefix."""
import argparse
from pathlib import Path
import shutil
import sys
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description="Install the GJS Dev OS shell under a prefix")
    parser.add_argument("--prefix", type=Path, default=Path.home() / ".local")
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("Run installation on Linux (or inside WSL)")
    prefix = args.prefix.expanduser().resolve()
    if prefix == ROOT or prefix.is_relative_to(ROOT):
        parser.error("Use an install prefix outside the source tree")
    destination = prefix / "share/dev-os"
    subprocess.run(["sh", str(ROOT / "tools/bootstrap-window-tracker.sh")], check=True)
    if not all((ROOT / f"dist/{name}.js").is_file()
               for name in ("main", "supervisor", "react-gtk", "panel-view", "launcher-view", "background-view")):
        parser.error("Run npm ci and npm run build before installing")
    for manifest_path in (ROOT / "extensions").glob("*/extension.json"):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("kind") == "ui":
            entry = manifest["entry"]
            if Path(entry).name != entry or not (ROOT / "dist" / entry).is_file():
                parser.error(f"Missing UI entry {entry}. Run npm run build before installing")
    if not all((ROOT / "dist/editor" / name).is_file() for name in
               ("index.html", "app.js", "app.css", "editor.worker.js", "ts.worker.js", "json.worker.js", "css.worker.js", "html.worker.js")):
        parser.error("Monaco assets missing. Run npm run build before installing")
    for name in ("src", "data", "config", "dist", "extensions"):
        shutil.copytree(ROOT / name, destination / name, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    bindir = prefix / "bin"
    native = destination / "native/dev-os-window-tracker"
    native.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / "build/native/dev-os-window-tracker", native)
    native.chmod(0o755)
    bindir.mkdir(parents=True, exist_ok=True)
    for source in (ROOT / "bin").iterdir():
        target = bindir / source.name
        shutil.copyfile(source, target)
        target.chmod(0o755)
    session = prefix / "share/wayland-sessions/dev-os.desktop"
    session.parent.mkdir(parents=True, exist_ok=True)
    executable = str(bindir / "dev-os-session")
    if any(char in executable for char in "\n\r"):
        parser.error("The prefix cannot contain newlines")
    quoted = executable.replace("\\", "\\\\\\\\").replace('"', '\\"')
    quoted = quoted.replace("`", "\\`").replace("$", "\\$").replace("%", "%%")
    template = (ROOT / "data/wayland-sessions/dev-os.desktop").read_text()
    template = template.replace("\nExec=dev-os-session\n", f'\nExec="{quoted}"\n')
    template = template.replace("TryExec=dev-os-session\n", f"TryExec={executable}\n")
    session.write_text(template, encoding="utf-8")
    print(f"Installed Dev OS to {prefix}")
    print(f"Start: {bindir / 'dev-os-session'} --nested")
    if not str(prefix).startswith("/usr"):
        print("For a display manager login entry, install with --prefix /usr/local and see README.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

