#!/bin/sh
# Boots a staged Live USB image in a visible QEMU (WSLg) window to look at the real session, splash included.
# Same direct-kernel boot as live-usb-boot.dev, but the real root session (no headless Wayland backend), a bochs
# display and a throwaway overlay (snapshot=on). Serial output goes to LOG. Usage: live-usb-window.sh STAGING [LOG]
set -eu
staging=${1:?usage: live-usb-window.sh STAGING [LOG]}
log=${2:-/tmp/devos-live-window.log}
uuid=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]+"/manifest.json"))["filesystemUuid"])' "$staging")
: >"$log"
exec qemu-system-aarch64 -machine virt -cpu max -accel tcg,thread=multi -smp 4 -m 4096 -no-reboot \
    -kernel "$staging/Image" -initrd "$staging/initramfs.cpio.gz" \
    -append "console=tty0 console=ttyAMA0 rdinit=/init devos.renderer=pixman devos.live.uuid=$uuid quiet splash loglevel=3 vt.global_cursor_default=0" \
    -drive "if=none,id=live,file=$staging/devos-live-arm64-ux3407na.img,format=raw,snapshot=on" \
    -device qemu-xhci,id=xhci -device usb-storage,bus=xhci.0,drive=live -device usb-kbd,bus=xhci.0 -device usb-tablet,bus=xhci.0 \
    -device bochs-display -display gtk,gl=off -serial "file:$log"
