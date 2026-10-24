#!/bin/bash
set -euo pipefail
work=${DEVOS_USB_WORK:-/var/tmp/devos-usb}
base=${DEVOS_BASE_WORK:-/var/tmp/devos-base}
source=$base/src/busybox-1.37.0
config=$base/src/linux-7.2.11/scripts/config
test -f "$source/Makefile" && test -x "$base/toolchain/bin/musl-gcc" || {
    echo 'Prepare the independent base toolchain first: .\distro.ps1 base' >&2; exit 2;
}
mkdir -p "$work/busybox-build"
make -s -C "$source" O="$work/busybox-build" allnoconfig
for option in STATIC BUSYBOX FEATURE_INSTALLER ASH SH_IS_ASH ASH_JOB_CONTROL \
    FEATURE_SH_STANDALONE FEATURE_SH_NOFORK MOUNT FEATURE_MOUNT_FLAGS FEATURE_MOUNT_HELPERS \
    SWITCH_ROOT MODPROBE FEATURE_MODUTILS_ALIAS FEATURE_MODUTILS_SYMBOLS \
    FINDFS BLKID FEATURE_BLKID_TYPE VOLUMEID FEATURE_VOLUMEID_EXT FEATURE_VOLUMEID_FAT \
    FEATURE_VOLUMEID_UUID FIND FEATURE_FIND_TYPE FEATURE_FIND_NAME FEATURE_FIND_EXEC \
    CAT MKDIR SLEEP SEQ ECHO TEST TEST1 TRUE FALSE CP CHMOD LN READLINK TR UNAME \
    FEATURE_READLINK_FOLLOW DMESG TIMEOUT KILL UMOUNT SYNC MV TAIL; do
    "$config" --file "$work/busybox-build/.config" --enable "$option"
done
# allnoconfig leaves strings empty when their dependency was initially off.
# Enabling MODPROBE later does not restore these defaults automatically.
"$config" --file "$work/busybox-build/.config" --set-str DEFAULT_MODULES_DIR /lib/modules
"$config" --file "$work/busybox-build/.config" --set-str DEFAULT_DEPMOD_FILE modules.dep
make -s -C "$source" O="$work/busybox-build" oldconfig </dev/null
grep -Fx 'CONFIG_DEFAULT_MODULES_DIR="/lib/modules"' "$work/busybox-build/.config" >/dev/null
grep -Fx 'CONFIG_DEFAULT_DEPMOD_FILE="modules.dep"' "$work/busybox-build/.config" >/dev/null
make -s -C "$source" O="$work/busybox-build" CC="$base/toolchain/bin/musl-gcc" -j2
if readelf -l "$work/busybox-build/busybox" | grep -q INTERP; then
    echo 'Live initramfs requires a statically linked BusyBox.' >&2; exit 2
fi
