SUMMARY = "Independent DevOs Wayland development image for QEMU ARM64"
LICENSE = "MIT"
inherit core-image
IMAGE_FEATURES = "package-management"
PACKAGE_EXCLUDE += "foot byobu vim vim-common vim-tiny vim-tools vim-syntax vim-help vim-tutor gvim"
IMAGE_INSTALL = "packagegroup-core-boot kernel-modules os-release devos-shell devos-session \
    gjs gtk+3 gtk-layer-shell libvte webkitgtk3 libsoup labwc swaylock \
    dbus util-linux-setsid python3-modules python3-pygobject libnm networkmanager networkmanager-nmcli \
    network-manager-applet gnome-control-center \
    coreutils git devos-pm devlang gh bluez5 pipewire pipewire-pulse wireplumber devos-x2-wireless-firmware devos-x2-audio-topology alsa-ucm-conf \
    polkit polkit-gnome kmod pciutils usbutils iproute2 iw rfkill wireless-regdb-static \
    adwaita-icon-theme shared-mime-info xdg-utils ca-certificates fontconfig \
    ttf-dejavu-sans ttf-tlwg xkeyboard-config tzdata devos-chrome devos-vscode \
    wdisplays pavucontrol power-profiles-daemon \
    util-linux-lsblk e2fsprogs e2fsprogs-resize2fs e2fsprogs-e2fsck dosfstools ntfs-3g ntfsprogs btrfs-tools xfsprogs"
IMAGE_FSTYPES = "ext4 tar.zst"
IMAGE_ROOTFS_EXTRA_SPACE = "524288"
