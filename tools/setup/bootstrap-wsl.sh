#!/bin/sh
# Ubuntu 24.04's labwc 0.7.1 aborts on WSLg's read-only X11 socket directory.
# Build a private, Wayland-only compositor; keep the system compositor untouched.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
source_dir="$project_root/build/wsl/labwc-source"
build_dir="$project_root/build/wsl/labwc-build"
bin_dir="$project_root/build/wsl/bin"

if [ ! -d "$source_dir/.git" ]; then
    mkdir -p "$project_root/build/wsl"
    git clone --depth 1 --branch 0.7.1 https://github.com/labwc/labwc.git "$source_dir"
fi
window_menu_patch="$project_root/tools/setup/patches/labwc-window-menu.patch"
if git -C "$source_dir" apply --reverse --check "$window_menu_patch" 2>/dev/null; then
    : # Already applied.
else
    git -C "$source_dir" apply --check "$window_menu_patch"
    git -C "$source_dir" apply "$window_menu_patch"
fi
for compositor_fix in tab-drag-focus tab-drag-escape app-icons; do
    compositor_patch="$project_root/tools/setup/patches/labwc-$compositor_fix.patch"
    if ! git -C "$source_dir" apply --reverse --check "$compositor_patch" 2>/dev/null; then
        git -C "$source_dir" apply --check "$compositor_patch"
        git -C "$source_dir" apply "$compositor_patch"
    fi
done
if [ ! -f "$build_dir/build.ninja" ]; then
    meson setup "$build_dir" "$source_dir" \
        -Dxwayland=disabled -Dman-pages=disabled -Dsvg=disabled -Dnls=disabled
fi
meson compile -C "$build_dir"
mkdir -p "$bin_dir"
install -m 755 "$build_dir/labwc" "$bin_dir/labwc"
printf 'WSLg compositor ready: %s/labwc\n' "$bin_dir"


sh "$project_root/tools/setup/bootstrap-terminal.sh"
sh "$project_root/tools/setup/bootstrap-lock.sh"
sh "$project_root/tools/setup/bootstrap-window-tracker.sh"
