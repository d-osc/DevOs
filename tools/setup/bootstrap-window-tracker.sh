#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
native_build="$project_root/build/native"
native_source="$project_root/native/window-tracker.c"
protocol="$project_root/native/protocols/wlr-foreign-toplevel-management-unstable-v1.xml"
target="$native_build/dev-os-window-tracker"
if [ -x "$target" ] && [ "$target" -nt "$native_source" ] && [ "$target" -nt "$protocol" ] && [ "$target" -nt "$0" ]; then exit 0; fi
mkdir -p "$native_build"
wayland-scanner client-header "$protocol" "$native_build/foreign-toplevel.h"
wayland-scanner private-code "$protocol" "$native_build/foreign-toplevel.c"
cc -std=c11 -O2 -Wall -Wextra -Werror -I"$native_build" \
    "$native_source" "$native_build/foreign-toplevel.c" \
    $(pkg-config --cflags --libs wayland-client) -o "$target.tmp"
chmod +x "$target.tmp"
mv "$target.tmp" "$target"
printf 'Wayland window tracker ready\n'
