#!/bin/sh
# Install native packages; run bootstrap-wsl.sh afterwards as the regular user.
set -eu
. /etc/os-release
if [ "${ID:-}" != ubuntu ]; then
    printf '%s\n' 'This installer supports Ubuntu; install equivalent packages manually on other distributions.' >&2
    exit 1
fi
if [ "$(id -u)" != 0 ]; then
    printf '%s\n' 'Run with sudo sh tools/setup/install-wsl-dependencies.sh' >&2
    exit 1
fi
apt-get update
apt-get install -y --no-install-recommends \
    build-essential pkg-config meson ninja-build git curl tar coreutils \
    gjs gir1.2-gtk-3.0 gir1.2-gtklayershell-0.1 gir1.2-vte-2.91 \
    gir1.2-webkit2-4.1 gir1.2-soup-3.0 dbus-daemon util-linux \
    xdg-utils pulseaudio-utils \
    libwayland-dev libwayland-bin wayland-protocols libgtk-3-dev \
    libinput-dev libxkbcommon-dev libpixman-1-dev libdrm-dev \
    libegl1-mesa-dev libgles2-mesa-dev libgbm-dev libudev-dev libseat-dev \
    hwdata libdisplay-info-dev libliftoff-dev \
    libxml2-dev libpango1.0-dev libpng-dev
sh "$(dirname -- "$0")/bootstrap-lock.sh"
