#!/bin/bash
set -euo pipefail
work=${DEVOS_LIVE_WORK:-/var/tmp/devos-live-build}
base_iso=${DEVOS_BASE_ISO:-/mnt/c/Users/ondev/Projects/driver/native-audit/images/stonking-desktop-arm64+x1e-20260929.iso}
root=$work/rootfs
iso=$work/iso
artifacts=$work/artifacts
release=$(cat "$artifacts/kernel/kernelrelease.txt")
mkdir -p "$artifacts" "$work/output"
export KBUILD_BUILD_USER=devos KBUILD_BUILD_HOST=ux3407na KBUILD_BUILD_TIMESTAMP='2026-10-16 00:00:00 UTC'
make -C "$work/linux-qcom-x1e-7.3.0" O="$work/kernel-out" ARCH=arm64 -j12 vmlinuz.efi
cp "$artifacts/kernel/config" "$root/boot/config-$release"
cp "$artifacts/kernel/System.map" "$root/boot/System.map-$release"
gzip -c -9 "$artifacts/kernel/Image" > "$artifacts/kernel/Image.gz"
cp "$work/kernel-out/arch/arm64/boot/vmlinuz.efi" "$artifacts/kernel/vmlinuz.efi"
cp "$artifacts/kernel/vmlinuz.efi" "$root/boot/vmlinuz-$release"
depmod -b "$root" "$release"
# Include modules selected by the stock Ubuntu initramfs policy, plus casper's
# boot hooks. Both kernels get the same DevOs live account/session settings.
chroot "$root" mkinitramfs -o "/tmp/devos-initrd-$release" "$release"
chroot "$root" mkinitramfs -o /tmp/devos-initrd-fallback 7.3.0-15-qcom-x1e
cp "$root/tmp/devos-initrd-$release" "$artifacts/initrd-devos"
cp "$root/tmp/devos-initrd-fallback" "$artifacts/initrd-fallback"
bash "$(dirname "$0")/sync-devos-live-uuid.sh"
mkdir -p "$artifacts/kernel/hwids"
cp "$root/usr/share/stubble/hwids/glymur-asus-zenbook-a14-ux3407na.json" "$artifacts/kernel/hwids/"
ukify build --efi-arch=aa64 --stub="$root/usr/lib/stubble/stubble.efi" \
    --linux="$artifacts/kernel/vmlinuz.efi" \
    --devicetree-auto="$artifacts/kernel/glymur-asus-zenbook-a14-ux3407na.dtb" \
    --hwids="$artifacts/kernel/hwids" --sbat=@"$root/usr/share/stubble/sbat" \
    --os-release=@"$root/etc/os-release" --uname="$release" \
    --output="$artifacts/devos-kernel.efi"
ukify inspect "$artifacts/devos-kernel.efi" > "$artifacts/kernel/uki-inspect.txt"
cp "$iso/casper/vmlinuz" "$artifacts/ubuntu-fallback-kernel.efi"
cp "$artifacts/devos-kernel.efi" "$iso/casper/vmlinuz"
cp "$artifacts/initrd-devos" "$iso/casper/initrd"
cp "$artifacts/ubuntu-fallback-kernel.efi" "$iso/casper/vmlinuz-fallback"
cp "$artifacts/initrd-fallback" "$iso/casper/initrd-fallback"
# Replace the layered installer filesystem with a single live-only filesystem.
# All removals below are restricted to the disposable staging tree.
find "$iso/casper" -maxdepth 1 -type f \( -name '*.squashfs' -o -name '*.manifest*' -o -name '*.size' -o -name 'install-sources.yaml' \) -delete
chroot "$root" dpkg-query -W --showformat='${Package} ${Version}\n' > "$iso/casper/filesystem.manifest"
cp "$iso/casper/filesystem.manifest" "$artifacts/rootfs-packages.txt"
printf '%s\n' "DevOs Live 0.3.6 / $release / ASUS UX3407NA / ARM64" > "$iso/.disk/info"
cat > "$iso/boot/grub/grub.cfg" <<'EOF'
set timeout=15
if [ -f /boot/grub/fonts/unicode.pf2 ]; then loadfont /boot/grub/fonts/unicode.pf2; fi
set menu_color_normal=white/black
set menu_color_highlight=black/light-gray
set cmdline="clk_ignore_unused pd_ignore_unused arm64.nopauth"
if [ "$lockdown" != "y" ]; then
    cutmem 0x8800000000 0x8fffffffff
fi
menuentry "DevOs Live - ASUS UX3407NA (safe graphics)" {
    set gfxpayload=keep
    linux /casper/vmlinuz $cmdline boot=casper cloud-init=disabled layerfs-path=filesystem.squashfs username=devos hostname=devos-live nopersistent console=tty0 ---
    initrd /casper/initrd
}
menuentry "DevOs Live - ASUS UX3407NA (automatic renderer)" {
    set gfxpayload=keep
    linux /casper/vmlinuz $cmdline boot=casper cloud-init=disabled layerfs-path=filesystem.squashfs username=devos hostname=devos-live nopersistent devos.renderer=auto console=tty0 ---
    initrd /casper/initrd
}
menuentry "DevOs Live - original Ubuntu Qualcomm kernel (fallback)" {
    set gfxpayload=keep
    linux /casper/vmlinuz-fallback $cmdline boot=casper cloud-init=disabled layerfs-path=filesystem.squashfs username=devos hostname=devos-live nopersistent console=tty0 ---
    initrd /casper/initrd-fallback
}
menuentry "UEFI Firmware Settings" { fwsetup }
EOF
# Preserve base /etc/os-release attribution; add DevOs-specific build metadata.
cat > "$root/etc/devos-release" <<EOF
NAME=DevOs
VERSION=0.3.6-live1
BASE=Ubuntu-Concept-26.10
KERNEL=$release
TARGET=ASUS-UX3407NA
EOF
chroot "$root" apt-get clean
find "$root/tmp" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
rm -f "$root/devos-chrome-setup.sh" "$root/usr/sbin/policy-rc.d" "$root/etc/machine-id" "$root/var/lib/dbus/machine-id"
touch "$root/etc/machine-id"
ln -sfn /etc/machine-id "$root/var/lib/dbus/machine-id"
ln -sfn /run/systemd/resolve/stub-resolv.conf "$root/etc/resolv.conf"
find "$root/var/log" -type f -exec truncate -s 0 {} +
umount -R "$root/dev"
umount "$root/proc"
umount -R "$root/sys"
du -sx --block-size=1 "$root" | cut -f1 > "$iso/casper/filesystem.size"
mksquashfs "$root" "$iso/casper/filesystem.squashfs" -noappend -comp zstd -Xcompression-level 15 -processors 4 > "$work/squashfs-build.log" 2>&1
(cd "$iso"; find . -type f ! -path './md5sum.txt' ! -path './boot.catalog' -print0 | LC_ALL=C sort -z | xargs -0 md5sum > md5sum.txt)
# Replay the original ARM64 EFI boot structure and appended FAT EFI partition.
bash "$(dirname "$0")/pack-devos-live-iso.sh"
printf '%s\n' 'DevOs live ISO built.'
