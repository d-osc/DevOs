#!/bin/bash
set -euo pipefail
work=${DEVOS_LIVE_WORK:-/var/tmp/devos-live-build}
hook=$(dirname "$0")/90devos-session
install -m755 "$hook" "$work/rootfs/usr/share/initramfs-tools/scripts/casper-bottom/90devos-session"
for flavor in devos fallback; do
    directory=$work/uuid-inspect-$flavor
    test -f "$directory/init"
    install -m755 "$hook" "$directory/scripts/casper-bottom/90devos-session"
    d "$(dirname "$0")/patch-initrd-order.dev" -- "$directory/scripts/casper-bottom/ORDER"
    (cd "$directory"; find . -print0 | cpio --null -o --format=newc 2>/dev/null | gzip -1) > "$work/artifacts/initrd-$flavor.new"
    mv "$work/artifacts/initrd-$flavor.new" "$work/artifacts/initrd-$flavor"
done
cp "$work/artifacts/initrd-devos" "$work/iso/casper/initrd"
cp "$work/artifacts/initrd-fallback" "$work/iso/casper/initrd-fallback"
echo 'Both live initrds include the DevOs session hook.'
