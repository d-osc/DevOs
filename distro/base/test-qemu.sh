#!/bin/bash
set -euo pipefail
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=${DEVOS_BASE_WORK:-/var/tmp/devos-base}
for name in Image initramfs.cpio.gz kernelrelease.txt; do
    test -s "$work/output/$name" || { echo "Missing $name; build the base first." >&2; exit 2; }
done
(cd "$work/output"; sha256sum -c SHA256SUMS)
devlang_bin="$(command -v d || true)"
[ -n "$devlang_bin" ] || devlang_bin="$HOME/.local/bin/d"
"$devlang_bin" "$here/verify.dev" -- "$work/output/initramfs.cpio.gz"
timeout 90 qemu-system-aarch64 -machine virt -cpu cortex-a72 -accel tcg,thread=multi \
    -smp 2 -m 512 -nographic -no-reboot \
    -kernel "$work/output/Image" -initrd "$work/output/initramfs.cpio.gz" \
    -append 'console=ttyAMA0 rdinit=/init panic=-1 devos.smoke=1' > "$work/output/qemu-boot.log" 2>&1
grep -F 'DEVOS_BASE_SMOKE_PASS' "$work/output/qemu-boot.log"
grep -F "$(cat "$work/output/kernelrelease.txt")" "$work/output/qemu-boot.log"
if grep -F 'Kernel panic' "$work/output/qemu-boot.log"; then exit 1; fi
grep -F 'reboot: Power down' "$work/output/qemu-boot.log" || grep -F 'reboot: Power off' "$work/output/qemu-boot.log"
echo 'PASS: DevOsLinuxKernel image and independent userspace booted and powered off in QEMU.'
