#!/bin/bash
set -euo pipefail
work=${DEVOS_LIVE_WORK:-/var/tmp/devos-live-build}
root=$work/rootfs
mkdir -p "$root/dev" "$root/proc" "$root/sys"
mountpoint -q "$root/dev" || mount --rbind /dev "$root/dev"
mount --make-rslave "$root/dev"
mountpoint -q "$root/proc" || mount -t proc proc "$root/proc"
mountpoint -q "$root/sys" || mount --rbind /sys "$root/sys"
mount --make-rslave "$root/sys"
cp --remove-destination /etc/resolv.conf "$root/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' > "$root/usr/sbin/policy-rc.d"
chmod 755 "$root/usr/sbin/policy-rc.d"
cat > "$root/etc/apt/sources.list.d/cdrom.sources" <<'EOF'
# Optical source disabled for reproducible network package staging.
EOF
chroot "$root" /bin/bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update; apt-get install -y --no-install-recommends gjs gir1.2-gtk-3.0 gir1.2-gtklayershell-0.1 gir1.2-vte-2.91 gir1.2-webkit2-4.1 gir1.2-soup-3.0 gir1.2-nm-1.0 swaylock dbus-daemon dbus-user-session network-manager-gnome network-manager-openvpn-gnome wireguard-tools bluez rfkill iw iproute2 libseat1 libdisplay-info3 libliftoff0 libxml2-16 pulseaudio-utils python3-gi casper initramfs-tools initramfs-tools-core seatd xdg-utils gnome-keyring policykit-1-gnome build-essential pkg-config libwayland-dev libwayland-bin wayland-protocols libgtk-3-dev libinput-dev libxkbcommon-dev libpixman-1-dev libdrm-dev libegl1-mesa-dev libgles2-mesa-dev libgbm-dev libudev-dev libseat-dev hwdata libdisplay-info-dev libliftoff-dev libxml2-dev libpango1.0-dev libpng-dev meson ninja-build git'
chroot "$root" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends stubble curl
printf '%s\n' 'Rootfs packages ready.'
