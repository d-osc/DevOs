#!/bin/bash
# Builds the Live USB image and the system update bundle for a release, on a Linux ARM64 build host (the self-hosted runner of
# .github/workflows/release-manual.yml, or your own WSL/Ubuntu). The same steps as tools/live/release-live-usb.ps1 without PowerShell.
#
#   tools/release/build-image-release.sh --version v0.3.7 --output build/release-image            (full: OE, staging, image, bundle)
#   tools/release/build-image-release.sh --version v0.3.7 --output out --stage /var/tmp/devos-usb/x2-… --image path.img --bundle-only
#
# Inputs (environment; they are not in the repository):
#   DEVOS_KERNEL_BUNDLE  kernel bundle directory (Image, board.dtb, modules/), built by DevOsLinuxKernel scripts/build-snapdragon-x2.sh
#   DEVOS_FIRMWARE_DIR   firmware bundle for the UX3407NA (distro/usb/stage-x2-firmware.ps1); firmware is not redistributed in the repo
#   DEVOS_STAGING_ROOT   default /var/tmp/devos-usb
#   --no-firmware        leave /usr/lib/firmware out of the public system bundle (vendor firmware licences: see docs/updates.md)
# Outputs in --output:
#   devos-live-<version>-arm64-ux3407na.img.zst.part-NN   the compressed image in parts below the 2 GiB GitHub release asset limit
#   dev-os-system-linux-arm64.tar.gz + .json              the system update bundle (boot image, modules, firmware) for Settings > Updates
#   IMAGE-INFO.txt                                         how to join and verify the parts
#   SHA256SUMS                                             of everything above (the release workflow merges it)
set -euo pipefail
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
version= output= stage= image= bundle_only=0 part_mib=1900 firmware=1 do_image=1 do_bundle=1
while [ $# -gt 0 ]; do
    case "$1" in
        --version) version=$2; shift 2 ;; --output) output=$2; shift 2 ;; --stage) stage=$2; shift 2 ;; --image) image=$2; shift 2 ;;
        --bundle-only) bundle_only=1; shift ;; --no-firmware) firmware=0; shift ;; --no-image) do_image=0; shift ;; --no-bundle) do_bundle=0; shift ;; --part-mib) part_mib=$2; shift 2 ;;
        *) echo "Unknown option $1" >&2; exit 2 ;;
    esac
done
[[ $version =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-ux3407na-dev)?$ ]] || { echo '--version must be vMAJOR.MINOR.PATCH, optionally followed by -ux3407na-dev' >&2; exit 2; }
[ -n "$output" ] || { echo '--output is required' >&2; exit 2; }
[ "$(uname -m)" = aarch64 ] || { echo 'The UX3407NA image is built on an ARM64 Linux host.' >&2; exit 2; }
for tool in d sfdisk mcopy debugfs zstd split sha256sum gjs; do command -v "$tool" >/dev/null || { echo "Missing build-host tool: $tool" >&2; exit 2; }; done
# Use the staging tool shipped by the checked-out branch.
prepare=(python3 "$root/distro/usb/prepare.py")
if [ -f "$root/distro/usb/prepare.dev" ]; then prepare=(d "$root/distro/usb/prepare.dev" --); fi
mkdir -p "$output"
output=$(CDPATH= cd -- "$output" && pwd)
name=${version#v}
build_version=${name%-ux3407na-dev}
staging_root=${DEVOS_STAGING_ROOT:-/var/tmp/devos-usb}

if [ "$bundle_only" = 0 ]; then
    : "${DEVOS_KERNEL_BUNDLE:?Set DEVOS_KERNEL_BUNDLE to the kernel bundle directory}"
    : "${DEVOS_FIRMWARE_DIR:?Set DEVOS_FIRMWARE_DIR to the UX3407NA firmware bundle}"
    [ -d "$DEVOS_KERNEL_BUNDLE" ] && [ -d "$DEVOS_FIRMWARE_DIR" ] || { echo 'Kernel bundle or firmware directory not found' >&2; exit 2; }
    if pgrep -a bitbake >/dev/null; then echo 'A bitbake process is already running; not starting a second build.' >&2; exit 75; fi
    # The release version must be what the shell reports: build with it, as tools/build/release.ts does.
    (cd "$root" && DEV_OS_RELEASE_VERSION=$build_version npm run build)
    DEVOS_KERNEL_PROJECT=${DEVOS_KERNEL_PROJECT:-} bash "$root/distro/oe/build.sh" --build
    bash "$root/distro/usb/busybox.sh"
    "${prepare[@]}" firmware-check --firmware "$DEVOS_FIRMWARE_DIR"
    stage="$staging_root/x2-release-$name-$(date +%Y%m%d-%H%M%S)"
    [ ! -e "$stage" ] || { echo "$stage already exists" >&2; exit 1; }
    # A release image is the plain variant (no DEVOS-LOGS diagnostics on the ESP).
    "${prepare[@]}" prepare --output "$stage" --kernel-bundle "$DEVOS_KERNEL_BUNDLE" --firmware "$DEVOS_FIRMWARE_DIR"
    "${prepare[@]}" build --output "$stage"
    "${prepare[@]}" check --output "$stage"
    rm -rf "$output/export"; mkdir -p "$output/export"
    "${prepare[@]}" export --output "$stage" --export-directory "$output/export"
    image="$output/export/devos-live-arm64-ux3407na.img"
fi
[ -d "$stage" ] && [ -f "$stage/rootfs.ext4" ] && [ -f "$stage/manifest.json" ] || { echo "--stage must be a prepared staging directory" >&2; exit 2; }
[ -f "$image" ] || { echo "--image must be the exported image" >&2; exit 2; }
kernel=$(sed -n 's/^ *"release": *"\([^"]*\)".*/\1/p' "$stage/manifest.json" | head -n 1)
[[ $kernel =~ ^[A-Za-z0-9._+-]+$ ]] || { echo 'Cannot read the kernel release from the staging manifest' >&2; exit 1; }
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT

if [ "$do_bundle" = 1 ]; then
# ---- System update bundle: boot image from the image's ESP, modules and firmware from the staged root file system ------------------
start=$(sfdisk -d "$image" | awk '$1 ~ /1$/ {gsub(",", "", $4); print $4; exit}')
[[ $start =~ ^[0-9]+$ ]] || { echo 'Cannot find the EFI partition in the image' >&2; exit 1; }
mcopy -i "$image@@$((start * 512))" ::/EFI/DEVOS/INSTALLED.EFI "$work/DEVOS.EFI"
mkdir -p "$work/rootfs/usr/lib/modules"
if ! debugfs -R "rdump /usr/lib/modules/$kernel $work/rootfs/usr/lib/modules" "$stage/rootfs.ext4" >/dev/null 2>&1 || [ ! -d "$work/rootfs/usr/lib/modules/$kernel" ]; then
    # The modules of a kernel bundle are copied into the image at build time; fall back to the bundle if the root file system has none.
    [ -n "${DEVOS_KERNEL_BUNDLE:-}" ] && [ -d "$DEVOS_KERNEL_BUNDLE/modules/lib/modules/$kernel" ] || { echo "Modules for $kernel not found in the root file system or the kernel bundle" >&2; exit 1; }
    cp -a "$DEVOS_KERNEL_BUNDLE/modules/lib/modules/$kernel" "$work/rootfs/usr/lib/modules/$kernel"
fi
find "$work/rootfs/usr/lib/modules/$kernel" -type l -delete
paths=("usr/lib/modules/$kernel")
if [ "$firmware" = 1 ] && debugfs -R "rdump /usr/lib/firmware $work/rootfs/usr/lib" "$stage/rootfs.ext4" >/dev/null 2>&1 && [ -d "$work/rootfs/usr/lib/firmware" ]; then
    find "$work/rootfs/usr/lib/firmware" -xtype l -delete
    paths+=(usr/lib/firmware)
fi
args=()
for path in "${paths[@]}"; do args+=(--root-path "$path"); done
gjs -m "$root/dist/make-system-bundle.js" --version "$build_version" --platform linux-arm64 --kernel "$kernel" --uki "$work/DEVOS.EFI" \
    --rootfs "$work/rootfs" "${args[@]}" --dereference --output "$output"

fi
if [ "$do_image" = 1 ]; then
# ---- The image: zstd, split below the 2 GiB asset limit ----------------------------------------------------------------------------
prefix="devos-live-$name-arm64-ux3407na.img.zst.part-"
rm -f "$output/$prefix"*
zstd -19 -T0 -q -c "$image" | split -b "${part_mib}M" -d -a 2 - "$output/$prefix"
cat > "$output/IMAGE-INFO.txt" <<EOF
Dev OS $version Live USB image (ARM64, ASUS Zenbook S 14 UX3407NA)
Join, verify and decompress:
  cat $prefix* | zstd -d > devos-live-arm64-ux3407na.img
  sha256sum devos-live-arm64-ux3407na.img      # $(sha256sum "$image" | cut -d' ' -f1)
Write it with distro/usb/write-usb.ps1 (it erases the USB disk after a typed confirmation).
Kernel $kernel. Secure Boot is not supported. Verify the parts with SHA256SUMS of this release.
EOF
fi
rm -f "$output/SHA256SUMS"
(cd "$output" && sha256sum $(ls | grep -E '^(devos-live-.*\.part-[0-9][0-9]|IMAGE-INFO\.txt|dev-os-system-linux-arm64\.(tar\.gz|json))$') > SHA256SUMS)
rm -rf "$output/export"
ls -l "$output"
