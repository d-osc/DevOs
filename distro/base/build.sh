#!/bin/bash
# ARM64 base using linux-kernel; host userspace is never copied into the image.
set -euo pipefail
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=${DEVOS_BASE_WORK:-/var/tmp/devos-base}
jobs=${DEVOS_BASE_JOBS:-4}
[[ $(uname -m) == aarch64 ]] || { echo 'This bootstrap currently requires an ARM64 Linux build host.' >&2; exit 2; }
[[ $work = /* && $work != / && $work != *[[:space:]]* ]] || { echo 'Use an absolute, non-root work path without spaces.' >&2; exit 2; }
for tool in gcc make curl tar sha256sum gzip flex bison bc python3 readelf rsync cpio; do
    command -v "$tool" >/dev/null || { echo "Missing build-host tool: $tool" >&2; exit 2; }
done
mkdir -p "$work/downloads" "$work/src" "$work/output" "$work/logs"
work=$(realpath "$work")
devlang_bin="$(command -v d || true)"
[ -n "$devlang_bin" ] || devlang_bin="$HOME/.local/bin/d"
"$devlang_bin" "$here/../kernel-cli.dev" -- --output "$work/devos-kernel" > "$work/logs/kernel-source.json"
kernel_version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$work/devos-kernel/devos-kernel.json")
kernel=$work/src/linux-$kernel_version
if [[ ! -d $kernel ]]; then tar -xf "$work/devos-kernel/devos-linux.tar.xz" -C "$work/src" --no-same-owner; fi
root=$(CDPATH= cd -- "$here/../.." && pwd)
userland=$work/repo-userland
bash "$root/tools/build/userland.sh" all "$userland" aarch64 > "$work/logs/userland.log" 2>&1
# Kernel host tools and UAPI come from the selected repository kernel.
make -C "$kernel" ARCH=arm64 INSTALL_HDR_PATH="$work/toolchain" headers_install > "$work/logs/kernel.log" 2>&1
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
file /etc/os-release $work/os-release 0644 0 0
file /init $here/init 0755 0 0
EOF
# gen_init_cpio consumes the bootstrap nodes; append the staged repo userland.
gcc -O2 "$kernel/usr/gen_init_cpio.c" -o "$work/gen_init_cpio"
"$work/gen_init_cpio" -t 1792108800 "$work/initramfs.list" > "$work/base.cpio"
(cd "$userland"; find . -print0 | cpio --null -o -H newc --owner=0:0 2>/dev/null) > "$work/userland.cpio"
cat "$work/base.cpio" "$work/userland.cpio" | gzip -n -9 > "$work/output/initramfs.cpio.gz"
cp "$work/devos-kernel/devos-kernel-Image" "$work/output/Image"
cp "$work/devos-kernel/devos-kernel.config" "$work/output/kernel.config"
cp "$here/sources.lock" "$work/output/sources.lock"
cp "$work/devos-kernel/devos-kernel.json" "$work/output/kernel-source.json"
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["release"])' "$work/output/kernel-source.json" > "$work/output/kernelrelease.txt"
(cd "$work/output"; sha256sum Image initramfs.cpio.gz kernel.config sources.lock kernel-source.json kernelrelease.txt > SHA256SUMS)
echo "Independent DevOs base built in $work/output (console only; not a desktop/hardware certification)."
