#!/bin/sh
# Collect evidence from a Live Linux boot. No package/module installation,
# network changes, mounts, formatting, firmware updates or partition changes.
set -eu
case "$(uname -r)" in *[Mm]icrosoft*|*WSL*)
    printf '%s\n' 'Run this from a native Linux Live boot, not WSL.' >&2; exit 2 ;;
esac
if [ "$(uname -m)" != aarch64 ]; then
    printf '%s\n' 'This audit targets the ARM64 ASUS UX3407NA.' >&2; exit 2
fi
model_file=/sys/firmware/devicetree/base/model
if [ ! -r "$model_file" ]; then
    printf '%s\n' 'No device-tree model is exposed. Check the boot image and exact board DTB first.' >&2; exit 2
fi
model=$(tr -d '\000' < "$model_file")
case "$model" in *UX3407NA*) ;; *)
    printf 'Expected UX3407NA device tree, got: %s\n' "$model" >&2; exit 2 ;;
esac
if [ "$#" != 1 ]; then
    printf '%s\n' 'Usage: sh collect-native-readiness.sh /path/to/new-report-directory' >&2; exit 2
fi
output=$1
if [ -e "$output" ]; then
    printf '%s\n' 'Choose a new report directory; existing reports are never overwritten.' >&2; exit 2
fi
mkdir -m 700 -- "$output"
capture() {
    name=$1; shift
    if command -v "$1" >/dev/null 2>&1; then
        if command -v timeout >/dev/null 2>&1; then
            timeout 15 "$@" > "$output/$name.txt" 2>&1 || printf 'Command failed, timed out or needs additional permissions: %s\n' "$*" >> "$output/$name.txt"
        else
            "$@" > "$output/$name.txt" 2>&1 || printf 'Command failed or needs additional permissions: %s\n' "$*" >> "$output/$name.txt"
        fi
    else printf 'Missing tool: %s\n' "$1" > "$output/$name.txt"; fi
}
printf 'Model: %s\nCaptured UTC: %s\n' "$model" "$(date -u +%FT%TZ)" > "$output/summary.txt"
capture kernel uname -a
# Machine identity and the hardware profile the Live boot selected (profiles/).
hwtool=
for candidate in /usr/bin/devos-hwprofile "${DEVOS_SOURCE_ROOT:-/nonexistent}/profiles/devos-hwprofile" "$(dirname "$0")/../../profiles/devos-hwprofile"; do
    if [ -r "$candidate" ]; then hwtool=$candidate; break; fi
done
if [ -n "$hwtool" ]; then
    capture hardware-identity sh "$hwtool" identify
    capture hardware-profile sh "$hwtool" select
else printf '%s\n' 'devos-hwprofile not found' > "$output/hardware-identity.txt"; fi
if [ -d /run/devos-hw ]; then
    mkdir -m 700 -- "$output/boot-hardware-profile"
    cp /run/devos-hw/identity.json /run/devos-hw/selection.json /run/devos-hw/profile.conf "$output/boot-hardware-profile/" 2>/dev/null || true
fi
capture os cat /etc/os-release
capture pci lspci -nnk
capture usb lsusb
capture modules lsmod
capture links ip -brief link
capture routes ip route
capture wireless-capabilities iw list
capture rfkill rfkill list
capture network-manager nmcli -f DEVICE,TYPE,STATE device status
capture bluetooth-controllers bluetoothctl list
capture bluetooth-status bluetoothctl show
capture mounts findmnt -rn -o SOURCE,TARGET,FSTYPE,OPTIONS
capture kernel-log dmesg
capture camera-list cam -l
capture camera-v4l2 v4l2-ctl --list-devices
capture camera-libcamera-plugin gst-inspect-1.0 libcamerasrc
capture camera-kernel-config sh -c '
    if [ -r /proc/config.gz ]; then zcat /proc/config.gz
    elif [ -r "/boot/config-$(uname -r)" ]; then cat "/boot/config-$(uname -r)"
    else printf "%s\n" "Kernel configuration unavailable"; exit 1; fi |
    grep -E "CONFIG_(VIDEO_OV02C10|VIDEO_QCOM_CAMSS|I2C_QCOM_CCI|PHY_QCOM_MIPI_CSI2|CLK_GLYMUR_CAMCC|MFD_QCOM_PM8008|REGULATOR_QCOM_PM8008|DMABUF_HEAPS|UDMABUF)"
'
{
    printf '%s\n' 'Camera nodes and permissions (no image capture):'
    ls -l /dev/media* /dev/video* /dev/v4l-subdev* /dev/dma_heap/* /dev/udmabuf 2>/dev/null || true
    printf '\n%s\n' 'Bound sensor/CCI/ISP drivers:'
    for device in /sys/bus/i2c/devices/* /sys/bus/platform/devices/*; do
        [ -L "$device/driver" ] || continue
        driver=$(readlink "$device/driver")
        case "$driver" in *ov02c10*|*camss*|*cci*|*csiphy*|*pm8008*|*pm8010*)
            printf '%s -> %s\n' "$device" "$driver" ;;
        esac
    done
    printf '\n%s\n' 'Camera device-tree nodes and status:'
    find /sys/firmware/devicetree/base -type d \( -name 'camera@*' -o -name 'cci@*' -o -name 'camss@*' -o -name 'csiphy@*' \) 2>/dev/null |
    while IFS= read -r node; do
        printf '%s\n' "$node"
        for property in compatible status; do
            if [ -r "$node/$property" ]; then
                printf '  %s: ' "$property"
                tr '\000' ' ' < "$node/$property"
                printf '\n'
            fi
        done
    done
} > "$output/camera-hardware.txt" 2>&1
for media in /dev/media*; do
    [ -c "$media" ] || continue
    capture "camera-graph-${media##*/}" media-ctl -d "$media" -p
done
{
    for base in /lib/firmware/ath12k/QCC2072/hw1.0 /lib/firmware/updates/ath12k/QCC2072/hw1.0 /lib/firmware/qcom/glymur/ASUSTeK/UX3407NA; do
        if [ -d "$base" ]; then
            find "$base" -maxdepth 2 -type f -exec sha256sum '{}' \;
        else printf 'Missing directory: %s\n' "$base"; fi
    done
} > "$output/firmware-hashes.txt" 2>&1
{
    for zone in /sys/class/thermal/thermal_zone*; do
        [ -d "$zone" ] || continue
        printf '%s: ' "$zone"
        cat "$zone/type" "$zone/temp" 2>/dev/null || true
    done
} > "$output/thermal.txt"
printf 'Collected local evidence in %s\n' "$output"
printf '%s\n' 'This is an evidence collection, not proof that Wi-Fi, AP mode, Bluetooth, suspend or GPU acceleration work.'
