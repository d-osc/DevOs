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
devlang_bin="${DEV_OS_DEVLANG:-}"
if [ -z "$devlang_bin" ]; then
    if command -v d >/dev/null 2>&1; then
        devlang_bin=d
    else
        devlang_bin="$HOME/.local/bin/d"
    fi
fi
"$devlang_bin" "$project_root/tools/setup/patch-task-view-gesture.dev" -- "$source_dir"
"$devlang_bin" "$project_root/tools/setup/patch-task-view-workspaces.dev" -- "$source_dir"
"$devlang_bin" "$project_root/tools/setup/patch-touchpad.dev" -- "$source_dir"
set --
if [ -f "$build_dir/build.ninja" ]; then set -- --reconfigure; fi
# Newer distro headers add enum members unknown to wlroots 0.17. Keep warnings
# visible without turning them into errors in this pinned compatibility build.
meson setup "$@" "$build_dir" "$source_dir" --force-fallback-for=wlroots \
        -Dxwayland=disabled -Dman-pages=disabled -Dsvg=disabled -Dnls=disabled \
        -Dwlroots:werror=false -Dwlroots:backends=drm,libinput \
        -Dwlroots:session=enabled -Dwlroots:renderers=gles2 -Dwlroots:allocators=gbm
meson compile -C "$build_dir"
mkdir -p "$bin_dir"
install -m 755 "$build_dir/labwc" "$bin_dir/labwc"
printf 'WSLg compositor ready: %s/labwc\n' "$bin_dir"


sh "$project_root/tools/setup/bootstrap-terminal.sh"
sh "$project_root/tools/setup/bootstrap-lock.sh"
sh "$project_root/tools/setup/bootstrap-window-tracker.sh"
sh "$project_root/tools/setup/bootstrap-media.sh"
