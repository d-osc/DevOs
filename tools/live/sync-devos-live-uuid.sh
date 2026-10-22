#!/bin/bash
set -euo pipefail
work=${DEVOS_LIVE_WORK:-/var/tmp/devos-live-build}
for flavor in devos fallback; do
    directory=$work/uuid-inspect-$flavor
    mkdir -p "$directory"
    unmkinitramfs "$work/artifacts/initrd-$flavor" "$directory"
    uuid_file=$(find "$directory" -path '*/conf/uuid.conf' -type f -print -quit)
    test -n "$uuid_file"
    cp "$uuid_file" "$work/iso/.disk/casper-uuid-$flavor"
    printf '%s: %s\n' "$flavor" "$(cat "$uuid_file")"
done
