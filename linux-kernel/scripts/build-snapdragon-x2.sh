#!/bin/bash
# Optional board profile. The default mainline 7.2.11 build stays unchanged.
set -euo pipefail
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work=${DEVOS_X2_WORK:-/var/tmp/devos-kernel-x2}
archive=${DEVOS_X2_ARCHIVE:-$work/linux-qcom-x1e_7.3.0-22.22.tar.gz}
source=${DEVOS_X2_SOURCE:-$work/linux-qcom-x1e-7.3.0}
build=${DEVOS_X2_BUILD:-$work/build}
bundle=$work/bundle
url=https://ppa.launchpadcontent.net/ubuntu-concept/x1e/ubuntu/pool/main/l/linux-qcom-x1e/linux-qcom-x1e_7.3.0-22.22.tar.gz
sha=c3cd51e563a3373ba029e7093c65a4a9951017b89f2b00417728fea54bfa0f5e18e521c69cc1543ac87860e00a658a2da5bcee3d8f92f4e3ba5de41ee50f8690
[[ $(uname -m) == aarch64 ]] || { echo 'This board profile requires an ARM64 build host.' >&2; exit 2; }
mkdir -p "$work" "$build" "$bundle"
exec 9>"$work/build.lock"
flock -n 9 || { echo 'The X2 kernel profile is already building.' >&2; exit 75; }
if [[ ! -f $archive ]]; then
    curl -fL --retry 3 "$url" -o "$archive.part"
    printf '%s  %s\n' "$sha" "$archive.part" | sha512sum -c -
    mv "$archive.part" "$archive"
fi
printf '%s  %s\n' "$sha" "$archive" | sha512sum -c -
if [[ ! -d $source ]]; then tar -xf "$archive" -C "$work" --no-same-owner; fi
# Verify cached source files against the pinned archive before reusing objects.
python3 "$repo/scripts/verify-x2-source.py" "$archive" "$source"
if [[ ! -f $build/.config ]]; then cp "$repo/config/profiles/snapdragon-x2.config" "$build/.config"; fi
cmp "$repo/config/profiles/snapdragon-x2.config" "$build/.config" || {
    echo 'Existing build config differs from the pinned X2 profile. Choose a fresh DEVOS_X2_BUILD.' >&2; exit 2;
}
export KBUILD_BUILD_USER=devos KBUILD_BUILD_HOST=ux3407na KBUILD_BUILD_TIMESTAMP='2026-10-16 00:00:00 UTC'
make -C "$source" O="$build" ARCH=arm64 olddefconfig
make -C "$source" O="$build" ARCH=arm64 -j"${DEVOS_X2_JOBS:-2}" Image modules qcom/glymur-asus-zenbook-a14-ux3407na.dtb
release=$(make -s -C "$source" O="$build" ARCH=arm64 kernelrelease)
[[ $release == 7.3.0-rc6-devos-x2 ]] || { echo "Unexpected kernel release: $release" >&2; exit 2; }
for setting in CONFIG_EFI_STUB=y CONFIG_OVERLAY_FS=y CONFIG_EXT4_FS=y CONFIG_MODULES=y CONFIG_DRM_SIMPLEDRM=y CONFIG_PINCTRL_GLYMUR=y CONFIG_CLK_GLYMUR_GCC=y CONFIG_CLK_GLYMUR_TCSRCC=y CONFIG_INTERCONNECT_QCOM_GLYMUR=y CONFIG_QCOM_CPUCP_MBOX=y CONFIG_QCOM_AOSS_QMP=y; do
    grep -Fx "$setting" "$build/.config" >/dev/null || { echo "Missing $setting" >&2; exit 2; }
done
cp "$build/arch/arm64/boot/Image" "$bundle/Image"
cp "$build/arch/arm64/boot/dts/qcom/glymur-asus-zenbook-a14-ux3407na.dtb" "$bundle/board.dtb"
cp "$build/.config" "$bundle/kernel.config"
make -C "$source" O="$build" ARCH=arm64 INSTALL_MOD_PATH="$bundle/modules" INSTALL_MOD_STRIP=1 modules_install
python3 "$repo/scripts/verify-x2-source.py" --manifest "$bundle" "$release" "$archive" "$url"
echo "DevOs X2 kernel bundle: $bundle (hardware boot testing still required)"
