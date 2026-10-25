#!/bin/sh
# Build the same PAM locker used by the image, with the Dev OS clock patch.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
source_dir="$project_root/build/wsl/swaylock-source"
build_dir="$project_root/build/wsl/swaylock-build"
if [ "$(id -u)" = 0 ]; then
    apt-get install -y git meson ninja-build pkg-config libpam0g-dev libcairo2-dev libwayland-dev wayland-protocols libxkbcommon-dev libgdk-pixbuf-2.0-dev
else
    sudo apt-get install -y git meson ninja-build pkg-config libpam0g-dev libcairo2-dev libwayland-dev wayland-protocols libxkbcommon-dev libgdk-pixbuf-2.0-dev
fi
if [ ! -f "$source_dir/main.c" ]; then
    git clone https://github.com/swaywm/swaylock.git "$source_dir"
    git -C "$source_dir" checkout 1a4c472c11ee0354e5a689e33fad4ecce533ddc3
fi
if ! grep -q 'devos_clock_tick' "$source_dir/main.c"; then
    patch -d "$source_dir" -p1 < "$project_root/distro/oe/meta-devos/recipes-support/swaylock/files/0001-devos-lock-clock.patch"
fi
if ! grep -q 'devos_dismiss_cover' "$source_dir/main.c"; then
    patch -d "$source_dir" -p1 < "$project_root/distro/oe/meta-devos/recipes-support/swaylock/files/0002-devos-lock-cover.patch"
fi
if ! grep -q 'devos_power_click' "$source_dir/seat.c"; then
    patch -d "$source_dir" -p1 < "$project_root/distro/oe/meta-devos/recipes-support/swaylock/files/0003-devos-lock-power.patch"
fi
set --
if [ -f "$build_dir/build.ninja" ]; then set -- --reconfigure; fi
meson setup "$@" "$build_dir" "$source_dir" -Dpam=enabled -Dman-pages=disabled
meson compile -C "$build_dir"
if [ "$(id -u)" = 0 ]; then
    install -m 755 "$build_dir/swaylock" /usr/local/bin/swaylock
else
    sudo install -m 755 "$build_dir/swaylock" /usr/local/bin/swaylock
fi
