#!/bin/bash
set -euo pipefail
work=${DEVOS_LIVE_WORK:-/var/tmp/devos-live-build}
stage=$work/kernel-smoke-initramfs
mkdir -p "$stage/bin" "$stage/lib/aarch64-linux-gnu" "$stage/lib" "$stage/dev" "$stage/proc" "$stage/sys"
cp /usr/lib/initramfs-tools/bin/busybox "$stage/bin/busybox"
cp /lib/ld-linux-aarch64.so.1 "$stage/lib/ld-linux-aarch64.so.1"
cp /lib/aarch64-linux-gnu/libc.so.6 "$stage/lib/aarch64-linux-gnu/libc.so.6"
cp /lib/aarch64-linux-gnu/libm.so.6 "$stage/lib/aarch64-linux-gnu/libm.so.6"
[[ -e "$stage/dev/console" ]] || mknod "$stage/dev/console" c 5 1
cat > "$work/kernel-smoke-poweroff.c" <<'EOF'
#include <sys/reboot.h>
int main(void) { return reboot(RB_POWER_OFF); }
EOF
cc -Os -static -s "$work/kernel-smoke-poweroff.c" -o "$stage/bin/poweroff-test"
cat > "$stage/init" <<'EOF'
#!/bin/busybox sh
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
echo DEVOS_KERNEL_SMOKE_PASS=$(/bin/busybox uname -r)
exec /bin/poweroff-test
EOF
chmod 755 "$stage/init"
(cd "$stage"; find . -print0 | cpio --null -o --format=newc 2>/dev/null | gzip -9) > "$work/kernel-smoke.cpio.gz"
timeout 120 qemu-system-aarch64 -machine virt -cpu max -accel tcg,thread=multi \
    -smp 2 -m 1024 -nographic -no-reboot \
    -kernel "$work/artifacts/kernel/Image" -initrd "$work/kernel-smoke.cpio.gz" \
    -append 'console=ttyAMA0 rdinit=/init panic=-1' > "$work/artifacts/kernel/qemu-smoke.log" 2>&1
grep -F "DEVOS_KERNEL_SMOKE_PASS=$(cat "$work/artifacts/kernel/kernelrelease.txt")" "$work/artifacts/kernel/qemu-smoke.log"
! grep -F 'Kernel panic' "$work/artifacts/kernel/qemu-smoke.log"
grep -F 'reboot: Power down' "$work/artifacts/kernel/qemu-smoke.log"
