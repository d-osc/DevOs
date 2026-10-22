#!/bin/bash
# ARM64 base using DevOsLinuxKernel; host userspace is never copied into the image.
set -euo pipefail
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=${DEVOS_BASE_WORK:-/var/tmp/devos-base}
jobs=${DEVOS_BASE_JOBS:-4}
[[ $(uname -m) == aarch64 ]] || { echo 'This bootstrap currently requires an ARM64 Linux build host.' >&2; exit 2; }
[[ $work = /* && $work != / && $work != *[[:space:]]* ]] || { echo 'Use an absolute, non-root work path without spaces.' >&2; exit 2; }
for tool in gcc make curl tar sha256sum gzip flex bison bc python3 readelf rsync; do
    command -v "$tool" >/dev/null || { echo "Missing build-host tool: $tool" >&2; exit 2; }
done
mkdir -p "$work/downloads" "$work/src" "$work/output" "$work/logs"
work=$(realpath "$work")
devlang_bin="$(command -v d || true)"
[ -n "$devlang_bin" ] || devlang_bin="$HOME/.local/bin/d"
"$devlang_bin" "$here/../kernel-cli.dev" -- --output "$work/devos-kernel" > "$work/logs/kernel-source.json"
kernel_version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$work/devos-kernel/devos-kernel.json")
while read -r component version digest url; do
    [[ -n $component && $component != \#* ]] || continue
    if [[ $component == linux ]]; then continue; fi
    archive=$work/downloads/${url##*/}
    if [[ ! -f $archive ]]; then
        curl --fail --location --retry 2 "$url" -o "$archive.part"
        printf '%s  %s\n' "$digest" "$archive.part" | sha256sum -c -
        mv "$archive.part" "$archive"
    fi
    printf '%s  %s\n' "$digest" "$archive" | sha256sum -c -
    if [[ ! -d $work/src/$component-$version ]]; then
        tar -xf "$archive" -C "$work/src" --no-same-owner
    fi
done < "$here/sources.lock"
kernel=$work/src/linux-$kernel_version
if [[ ! -d $kernel ]]; then tar -xf "$work/devos-kernel/devos-linux.tar.xz" -C "$work/src" --no-same-owner; fi
musl=$work/src/musl-1.2.5
busybox=$work/src/busybox-1.37.0
mkdir -p "$work/musl-build" "$work/kernel-build" "$work/busybox-build"
if [[ ! -x $work/toolchain/bin/musl-gcc ]]; then
    (cd "$work/musl-build"; "$musl/configure" --prefix="$work/toolchain" --disable-shared
     make -j"$jobs"; make install) > "$work/logs/musl.log" 2>&1
fi
# Use the selected project's kernel Image and exact matching config. No host kernel.
config=$kernel/scripts/config
make -C "$kernel" ARCH=arm64 INSTALL_HDR_PATH="$work/toolchain" headers_install > "$work/logs/kernel.log" 2>&1
make -C "$busybox" O="$work/busybox-build" allnoconfig > "$work/logs/busybox.log" 2>&1
for option in STATIC ASH SH_IS_ASH ASH_JOB_CONTROL ASH_ALIAS ASH_ECHO ASH_PRINTF ASH_TEST ASH_OPTIMIZE_FOR_SIZE \
    MOUNT FEATURE_MOUNT_FLAGS MKDIR HOSTNAME CAT UNAME SED TEST PRINTF SYNC POWEROFF HALT SETSID CTTYHACK; do
    "$config" --file "$work/busybox-build/.config" --enable "$option"
done
# BusyBox uses Kconfig too; oldconfig accepts source-defined defaults.
make -C "$busybox" O="$work/busybox-build" oldconfig </dev/null >> "$work/logs/busybox.log" 2>&1
make -C "$busybox" O="$work/busybox-build" CC="$work/toolchain/bin/musl-gcc" -j"$jobs" >> "$work/logs/busybox.log" 2>&1
if readelf -l "$work/busybox-build/busybox" | grep -q INTERP; then
    echo 'Refusing a dynamically linked bootstrap userspace.' >&2; exit 1
fi
printf 'NAME="DevOs"\nID=devos\nPRETTY_NAME="DevOs Independent Base"\nVERSION_ID=0.1\n' > "$work/os-release"
cat > "$work/initramfs.list" <<EOF
dir /bin 0755 0 0
dir /sbin 0755 0 0
dir /usr 0755 0 0
dir /usr/bin 0755 0 0
dir /usr/sbin 0755 0 0
dir /etc 0755 0 0
dir /dev 0755 0 0
dir /dev/pts 0755 0 0
dir /proc 0755 0 0
dir /sys 0755 0 0
dir /tmp 1777 0 0
dir /run 0755 0 0
dir /root 0700 0 0
nod /dev/console 0600 0 0 c 5 1
nod /dev/null 0666 0 0 c 1 3
file /bin/busybox $work/busybox-build/busybox 0755 0 0
file /etc/os-release $work/os-release 0644 0 0
file /init $here/init 0755 0 0
EOF
for applet in sh mount mkdir hostname cat uname sed test printf sync poweroff setsid cttyhack; do
    printf 'slink /bin/%s busybox 0777 0 0\n' "$applet" >> "$work/initramfs.list"
done
gcc -O2 "$kernel/usr/gen_init_cpio.c" -o "$work/gen_init_cpio"
"$work/gen_init_cpio" -t 1792108800 "$work/initramfs.list" | gzip -n -9 > "$work/output/initramfs.cpio.gz"
cp "$work/devos-kernel/devos-kernel-Image" "$work/output/Image"
cp "$work/devos-kernel/devos-kernel.config" "$work/output/kernel.config"
cp "$here/sources.lock" "$work/output/sources.lock"
cp "$work/devos-kernel/devos-kernel.json" "$work/output/kernel-source.json"
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["release"])' "$work/output/kernel-source.json" > "$work/output/kernelrelease.txt"
(cd "$work/output"; sha256sum Image initramfs.cpio.gz kernel.config sources.lock kernel-source.json kernelrelease.txt > SHA256SUMS)
echo "Independent DevOs base built in $work/output (console only; not a desktop/hardware certification)."
