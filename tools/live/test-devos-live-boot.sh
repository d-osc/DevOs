#!/bin/bash
set -euo pipefail
work=${DEVOS_LIVE_WORK:-/var/tmp/devos-live-build}
cp /usr/share/AAVMF/AAVMF_VARS.fd "$work/qemu-live-vars.fd"
timeout 600 qemu-system-aarch64 -machine virt -cpu cortex-a72 \
    -accel tcg,thread=multi -smp 4 -m 4096 -display none \
    -bios /usr/share/qemu-efi-aarch64/QEMU_EFI.fd \
    -device virtio-gpu-pci -device qemu-xhci,id=xhci \
    -device usb-kbd,bus=xhci.0 -device usb-tablet,bus=xhci.0 \
    -drive if=none,id=live,format=raw,readonly=on,file="$work/output/devos-live-arm64-ux3407na.iso" \
    -device usb-storage,bus=xhci.0,drive=live,bootindex=1 \
    -netdev user,id=network -device virtio-net-pci,netdev=network \
    -serial file:"$work/artifacts/vm-boot-serial.log" \
    -qmp unix:"$work/qemu-live-qmp.sock",server=on,wait=off \
    > "$work/artifacts/vm-boot-qemu.log" 2>&1
