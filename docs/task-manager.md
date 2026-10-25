# Task Manager

Open **Applications → Task Manager**, or right-click the panel and select **Task Manager**. The panel menu item can be toggled in Panel settings. The shell command is `dev-os-shell task-manager`.

Settings > Extensions > Task Manager shows a CPU/memory/swap snapshot, process count and uptime. Refresh snapshot reloads the data; Open Task Manager opens the live monitor. The settings page does not stop processes or poll in the background, and releases its sampler when closed.

The monitor reads Linux `/proc`, showing total CPU, memory, swap and individual process CPU, resident memory, owner, PID and state. Search by name, PID or user and sort by CPU, memory, name or PID. Updates run every two seconds while the window is focused, every eight seconds while it is visible behind other windows, and stop while it is minimised; they can also be paused. Unchanged samples do not re-render, rows update in place, and the list shows the first 200 processes. Process CPU uses 100% for one logical CPU. In WSL this covers the Linux distribution's processes, rather than Windows applications. Memory totals follow `/proc/meminfo` and include the kernel's available-memory estimate.

The sampler gets page size and CPU clock ticks directly from libc. It does not require the `getconf` utility, which is
absent from the minimal Live image. A missing `getconf` previously produced zero sampling parameters and caused the
helper to exit; the UI then reported a broken pipe. The CLI regression test covers this image configuration.

Select a process, then **End task…** to review the confirmation. **End task** sends SIGTERM; **Force stop** sends SIGKILL and may lose unsaved work. Only processes belonging to the current non-root user can be stopped. PID 1, the monitor and its ancestors, and labwc are protected. A Linux pidfd and process start time prevent signalling a replacement process after PID reuse. There is no privilege escalation. Kernels or Python runtimes without pidfd support can monitor processes but cannot stop them through this UI.

Performance: the sampler reads each `/proc/PID/stat` once per refresh and reads a process's owner from `/proc/PID/status` only the first time it appears (cached by PID and start time); it never spawns subprocesses per process. `python3 tests/processes.test.py` includes a refresh benchmark with 150 extra processes (about 0.35 ms per process per sample, down from about 4 ms when each process spawned `sh` and `stat`).

Validation: `npm run build`; `python3 tests/processes.test.py` as a Linux desktop user; `GDK_BACKEND=wayland gjs -m dist/task-manager-test.js`. The Python test stops only its own disposable sleep children.
