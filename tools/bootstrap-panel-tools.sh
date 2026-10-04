#!/bin/sh
# WSLg exposes PulseAudio; provide pactl without changing system packages.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if command -v pactl >/dev/null 2>&1 || command -v wpctl >/dev/null 2>&1; then exit 0; fi
if [ -x "$project_root/build/wsl/bin/pactl" ]; then exit 0; fi
prefix="$project_root/build/wsl/panel-tools"
mkdir -p "$prefix" "$project_root/build/wsl/bin"
cd "$prefix"
apt-get download pulseaudio-utils
for package in ./*.deb; do dpkg-deb -x "$package" "$prefix"; done
install -m 755 "$prefix/usr/bin/pactl" "$project_root/build/wsl/bin/pactl"
