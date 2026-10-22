#!/bin/bash
set -euo pipefail
cd "${DEVOS_LIVE_WORK:-/var/tmp/devos-live-build}"
if [[ -e rootfs/etc/os-release ]]; then
    printf '%s\n' 'A rootfs already exists; refusing to replace it.' >&2
    exit 1
fi
mkdir -p lower/base lower/standard lower/live merged rootfs
# WSL's host kernel lacks squashfs XZ support. Extract with userspace first;
# overlayfs still applies the live layer's whiteouts and opaque directories.
unsquashfs -f -processors 4 -d lower/base iso/casper/minimal.squashfs
unsquashfs -f -processors 4 -d lower/standard iso/casper/minimal.standard.squashfs
unsquashfs -f -processors 4 -d lower/live iso/casper/minimal.standard.live.squashfs
mount -t overlay overlay -o "lowerdir=$PWD/lower/live:$PWD/lower/standard:$PWD/lower/base" merged
trap 'umount merged' EXIT
cp -a merged/. rootfs/
umount merged
trap - EXIT
echo Rootfs-merged
