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
