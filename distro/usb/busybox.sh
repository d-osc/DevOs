#!/bin/bash
# Keep the historical artifact path; build only from busybox-cli in this repo.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=${DEVOS_USB_WORK:-/var/tmp/devos-usb}
stage=$work/repo-busybox-root
bash "$root/tools/build/userland.sh" busybox "$stage" aarch64
mkdir -p "$work/busybox-build"
install -m755 "$stage/bin/busybox" "$work/busybox-build/busybox"
# usbimage.dev includes this companion shell in the initramfs.
install -m755 "$stage/usr/libexec/devos/dash" "$work/busybox-build/dash"
