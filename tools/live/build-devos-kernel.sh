#!/bin/bash
set -euo pipefail
work=${DEVOS_LIVE_WORK:-/var/tmp/devos-live-build}
src=$work/linux-qcom-x1e-7.3.0
out=$work/kernel-out
mkdir -p "$out" "$work/artifacts/kernel"
if [[ ! -f "$out/.config" ]]; then
    cp "$work/rootfs/boot/config-7.3.0-15-qcom-x1e" "$out/.config"
    "$src/scripts/config" --file "$out/.config" \
        --set-str LOCALVERSION '-devos-x2' --disable LOCALVERSION_AUTO \
        --set-str SYSTEM_TRUSTED_KEYS '' --set-str SYSTEM_REVOCATION_KEYS '' \
        --disable MODULE_SIG_ALL --disable GENDWARFKSYMS --disable EXTENDED_MODVERSIONS \
        --disable DEBUG_INFO_BTF --disable DEBUG_INFO_BTF_MODULES \
        --disable DEBUG_INFO_DWARF_TOOLCHAIN_DEFAULT --disable DEBUG_INFO_DWARF5 --enable DEBUG_INFO_NONE \
        --disable GDB_SCRIPTS --disable RUST \
        --enable TUN --module WIREGUARD --enable RFKILL --enable CFG80211 \
        --enable OVERLAY_FS --enable SQUASHFS --enable SQUASHFS_XZ
fi
"$src/scripts/config" --file "$out/.config" --disable GENDWARFKSYMS --disable EXTENDED_MODVERSIONS --disable DEBUG_INFO_DWARF5 --enable DEBUG_INFO_NONE
# Keep Qualcomm hardware and ARM virtual machines; do not carry every unrelated
# ARM server/phone SoC into this machine-specific kernel.
while read -r platform; do
    case "$platform" in ARCH_QCOM|ARCH_VEXPRESS) ;; *) "$src/scripts/config" --file "$out/.config" --disable "$platform" ;; esac
done < <(awk '/^config ARCH_/ { print $2 }' "$src/arch/arm64/Kconfig.platforms")
"$src/scripts/config" --file "$out/.config" \
    --disable DRM_AMDGPU --disable DRM_RADEON --disable DRM_NOUVEAU \
    --disable DRM_I915 --disable DRM_XE --disable DRM_PANFROST --disable DRM_PANTHOR \
    --disable DRM_LIMA --disable DRM_ETNAVIV --disable DRM_ROCKCHIP \
    --disable DRM_TEGRA --disable DRM_EXYNOS --disable DRM_MESON
export KBUILD_BUILD_USER=devos KBUILD_BUILD_HOST=ux3407na KBUILD_BUILD_TIMESTAMP='2026-10-16 00:00:00 UTC'
make -C "$src" O="$out" ARCH=arm64 olddefconfig
make -C "$src" O="$out" ARCH=arm64 -j"${DEVOS_KERNEL_JOBS:-12}" Image modules qcom/glymur-asus-zenbook-a14-ux3407na.dtb
make -s -C "$src" O="$out" ARCH=arm64 kernelrelease > "$work/artifacts/kernel/kernelrelease.txt"
cp "$out/.config" "$work/artifacts/kernel/config"
cp "$out/System.map" "$work/artifacts/kernel/System.map"
cp "$out/arch/arm64/boot/Image" "$work/artifacts/kernel/Image"
cp "$out/arch/arm64/boot/dts/qcom/glymur-asus-zenbook-a14-ux3407na.dtb" "$work/artifacts/kernel/"
make -C "$src" O="$out" ARCH=arm64 INSTALL_MOD_PATH="$work/rootfs" INSTALL_MOD_STRIP=1 modules_install
printf '%s\n' 'DevOs kernel compilation and module staging completed.'
