#!/bin/sh
# Keep the virtual pointer alive long enough for GTK to receive a real press
# and send its window-menu request before release/device removal.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
d "$project_root/tools/setup/prepare-pointer-test.dev"
source_dir="$project_root/build/wsl/wlrctl-source/wlrctl-0.2.2"
build_dir="$project_root/build/wsl/wlrctl-build"
pointer_patch="$project_root/tools/setup/patches/wlrctl-pointer-lifetime.patch"
if ! git -C "$source_dir" apply --reverse --check "$pointer_patch" 2>/dev/null; then
    git -C "$source_dir" apply --check "$pointer_patch"
    git -C "$source_dir" apply "$pointer_patch"
fi
if [ ! -f "$build_dir/build.ninja" ]; then
    meson setup "$build_dir" "$source_dir"
fi
meson compile -C "$build_dir"
install -m 755 "$build_dir/wlrctl" "$project_root/build/wsl/bin/dev-os-test-pointer"
pointer_build="$project_root/build/native"
mkdir -p "$pointer_build"
wayland-scanner client-header "$project_root/native/protocols/wlr-virtual-pointer-unstable-v1.xml" "$pointer_build/virtual-pointer.h"
wayland-scanner private-code "$project_root/native/protocols/wlr-virtual-pointer-unstable-v1.xml" "$pointer_build/virtual-pointer.c"
cc -std=c11 -O2 -Wall -Wextra -I"$pointer_build" "$project_root/tools/setup/pointer-session.c" "$pointer_build/virtual-pointer.c" \
    $(pkg-config --cflags --libs wayland-client) -o "$project_root/build/wsl/bin/dev-os-test-pointer-session"
