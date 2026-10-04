#!/usr/bin/env python3
"""Fast checks that can also run on Windows, without GTK."""
import ast
from pathlib import Path
import sys
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]

for directory in ("src", "tools", "tests", "bin"):
    for path in (ROOT / directory).rglob("*"):
        if path.is_file() and path.suffix == ".py":
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
for path in (ROOT / "config/labwc").glob("*.xml"):
    ET.parse(path)
print("Development tool syntax and compositor XML: OK", flush=True)
if sys.platform != "linux":
    print("Run .\\dev.ps1 check for GJS tests inside WSL.")
    raise SystemExit(0)
for name in ("config-test", "extensions-test"):
    result = subprocess.call(["gjs", "-m", str(ROOT / f"dist/{name}.js")])
    if result:
        raise SystemExit(result)
raise SystemExit(0)

