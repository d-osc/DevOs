#!/usr/bin/env python3
"""One-time migration of the previous Python shell's TOML config to JSON."""
import argparse
import json
import os
from pathlib import Path
import tomllib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, default=Path(
    os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "dev-os/config.toml")
parser.add_argument("--destination", type=Path)
args = parser.parse_args()
destination = args.destination or args.source.with_suffix(".json")
with args.source.open("rb") as source:
    data = tomllib.load(source)
destination.parent.mkdir(parents=True, exist_ok=True)
# Exclusive create preserves an existing JSON config and the original TOML file.
with destination.open("x", encoding="utf-8") as output:
    json.dump(data, output, ensure_ascii=False, indent=2)
    output.write("\n")
print(f"Migrated {args.source} to {destination}; original preserved.")
