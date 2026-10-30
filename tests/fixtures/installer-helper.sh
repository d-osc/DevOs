#!/bin/sh
# Test double for bin/dev-os-install: never touches a disk.
case "$1" in
disks) printf '[{"name":"sdz","path":"/dev/sdz","size":128849018880,"model":"Test Disk","transport":"sata","removable":false,"contents":"ext4"}]\n' ;;
run)
    IFS= read -r password
    [ "$password" = "secret" ] || { echo "ERROR bad password"; exit 1; }
    echo "noise from a tool"
    echo "STEP 1/10 Partitioning"; sleep 1; echo "STEP 2/10 Copying"; sleep 1
    [ "${INSTALL_FAIL:-}" = 1 ] && { echo "ERROR copy failed"; exit 1; }
    echo "DONE Remove the USB drive" ;;
esac
