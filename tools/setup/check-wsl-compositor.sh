#!/bin/sh
# Expected missing/stale state is exit 1, never native stderr in PowerShell 5.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
source_dir="$project_root/build/wsl/labwc-source"
binary="$project_root/build/wsl/bin/labwc"
test -d "$source_dir/.git" && test -x "$binary" || exit 1
for asset in tools/setup/patch-task-view-workspaces.dev tools/setup/devos-workspaces.c native/protocols/devos-workspaces-v1.xml tools/setup/patch-task-view-gesture.dev tools/setup/devos-task-view.h tools/setup/devos-desktop-animation.h tools/setup/devos-window-animation.c; do
    test "$project_root/$asset" -nt "$binary" && exit 1
done
for fix in window-menu tab-drag-focus tab-drag-escape app-icons; do
    patch="$project_root/tools/setup/patches/labwc-$fix.patch"
    test "$patch" -nt "$binary" && exit 1
    git -C "$source_dir" apply --reverse --check "$patch" >/dev/null 2>&1 || exit 1
done
