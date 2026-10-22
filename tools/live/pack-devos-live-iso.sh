#!/bin/bash
set -euo pipefail
work=${DEVOS_LIVE_WORK:-/var/tmp/devos-live-build}
base_iso=${DEVOS_BASE_ISO:-/mnt/c/Users/ondev/Projects/driver/native-audit/images/stonking-desktop-arm64+x1e-20260929.iso}
output=$work/output/devos-live-arm64-ux3407na.iso
test -s "$work/iso/casper/filesystem.squashfs"
mkdir -p "$work/output"
(cd "$work/iso"; find . -type f ! -path './md5sum.txt' ! -path './boot.catalog' -print0 | LC_ALL=C sort -z | xargs -0 md5sum > md5sum.txt)
if [[ -e "$output" ]]; then mv "$output" "$output.previous"; fi
# -map merges directories. Remove the old casper tree explicitly so that the
# Ubuntu layered installer files cannot survive beside our live filesystem.
xorriso -indev "$base_iso" -outdev "$output" \
    -rm_r /casper -- -map "$work/iso" / \
    -volid DEVOS_LIVE_ARM64 -boot_image any replay -padding 0 \
    -commit -end > "$work/iso-build.log" 2>&1
sha256sum "$output" > "$work/output/SHA256SUMS"
echo 'DevOs ISO packed.'
