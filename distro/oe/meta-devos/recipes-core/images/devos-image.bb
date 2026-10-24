SUMMARY = "Independent DevOs Wayland development image for QEMU ARM64"
LICENSE = "MIT"
inherit core-image
IMAGE_FEATURES = "package-management"
PACKAGE_EXCLUDE += "foot byobu vim vim-common vim-tiny vim-tools vim-syntax vim-help vim-tutor gvim"
IMAGE_INSTALL = "packagegroup-core-boot kernel-modules os-release devos-shell devos-session \
    gjs gtk+3 gtk-layer-shell libvte webkitgtk3 libsoup labwc swaylock \
    dbus util-linux-setsid util-linux-lscpu python3-modules python3-pygobject libnm networkmanager networkmanager-nmcli \
    network-manager-applet gnome-control-center \
    coreutils cups git devos-pm devlang gh bluez5 bluez5-noinst-tools pipewire pipewire-pulse wireplumber devos-x2-wireless-firmware devos-x2-audio-topology alsa-ucm-conf \
    polkit polkit-gnome kmod pciutils usbutils iproute2 iw rfkill wireless-regdb-static \
    adwaita-icon-theme shared-mime-info xdg-utils ca-certificates sudo curl fontconfig \
    ttf-dejavu-sans ttf-tlwg xkeyboard-config tzdata devos-chrome devos-vscode \
    gstreamer1.0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good libcamera libcamera-gst v4l-utils alsa-utils \
    wlr-randr wlopm power-profiles-daemon \
    util-linux-lsblk e2fsprogs e2fsprogs-resize2fs e2fsprogs-e2fsck dosfstools ntfs-3g ntfsprogs btrfs-tools xfsprogs \
    python3 python3-pip python3-venv python3-ensurepip nodejs nodejs-npm rust cargo"
IMAGE_FSTYPES = "ext4 tar.zst"
IMAGE_ROOTFS_EXTRA_SPACE = "524288"
