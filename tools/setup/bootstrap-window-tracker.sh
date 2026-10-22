#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
native_build="$project_root/build/native"
native_source="$project_root/native/window-tracker.c"
protocol="$project_root/native/protocols/wlr-foreign-toplevel-management-unstable-v1.xml"
desktop_protocol="$project_root/native/protocols/devos-workspaces-v1.xml"
target="$native_build/dev-os-window-tracker"
if [ -x "$target" ] && [ "$target" -nt "$native_source" ] && [ "$target" -nt "$protocol" ] && [ "$target" -nt "$desktop_protocol" ] && [ "$target" -nt "$0" ]; then exit 0; fi
mkdir -p "$native_build"
wayland-scanner client-header "$protocol" "$native_build/foreign-toplevel.h"
wayland-scanner private-code "$protocol" "$native_build/foreign-toplevel.c"
wayland-scanner client-header "$desktop_protocol" "$native_build/devos-workspaces.h"
wayland-scanner private-code "$desktop_protocol" "$native_build/devos-workspaces.c"
cc -std=c11 -O2 -Wall -Wextra -Werror -I"$native_build" \
    "$native_source" "$native_build/foreign-toplevel.c" "$native_build/devos-workspaces.c" \
    $(pkg-config --cflags --libs wayland-client) -o "$target.tmp"
chmod +x "$target.tmp"
mv "$target.tmp" "$target"
printf 'Wayland window tracker ready\n'
