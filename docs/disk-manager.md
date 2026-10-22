# Disk Manager

Open **Applications > Disk Manager**, right-click the panel and select **Disk Manager**, or run `dev-os-shell disk-manager`.

Disk Manager displays Linux block devices, capacity, partition tables, filesystems, mounts, UUIDs and filesystem usage where available. Refresh reloads the inventory. The chart shows relative partition sizes, not exact sector boundaries.

Settings > Extensions > Disk Manager provides device, partition and mounted-volume counts, detected-device summaries, WSL session information, Refresh, and Open Disk Manager. All settings-page queries are read-only; errors can be retried with Refresh.

This is a read-only disk overview. Partition creation, deletion, formatting and resizing are currently unavailable. It does not request administrator access or launch an external partition editor.

On WSL it shows Linux virtual disks and explicitly attached block devices. Windows drive mounts such as `/mnt/c` do not expose the physical Windows disk here.

Validation: `npm run build`; `python3 tests/disks.test.py`; `GDK_BACKEND=wayland gjs -m dist/disk-manager-test.js`.
