#!/bin/sh
# Provide the GTK3 VTE typelib in a private WSL prefix when it is not installed.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
prefix="$project_root/build/wsl/vte"
if gjs -c "imports.gi.versions.Vte='2.91'; imports.gi.Vte;" >/dev/null 2>&1; then exit 0; fi
if [ -f "$prefix/usr/lib/x86_64-linux-gnu/girepository-1.0/Vte-2.91.typelib" ]; then exit 0; fi
mkdir -p "$prefix"
cd "$prefix"
apt-get download gir1.2-vte-2.91 libvte-2.91-0 libvte-2.91-common
for package in ./*.deb; do dpkg-deb -x "$package" "$prefix"; done
printf 'Terminal dependencies ready: %s\n' "$prefix"
