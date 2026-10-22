# Task Manager

Open **Applications → Task Manager**, or right-click the panel and select **Task Manager**. The panel menu item can be toggled in Panel settings. The shell command is `dev-os-shell task-manager`.

Settings > Extensions > Task Manager shows a CPU/memory/swap snapshot, process count and uptime. Refresh snapshot reloads the data; Open Task Manager opens the live monitor. The settings page does not stop processes or poll in the background, and releases its sampler when closed.

The monitor reads Linux `/proc`, showing total CPU, memory, swap and individual process CPU, resident memory, owner, PID and state. Search by name, PID or user and sort by CPU, memory, name or PID. Updates run every two seconds and can be paused. Process CPU uses 100% for one logical CPU. In WSL this covers the Linux distribution's processes, rather than Windows applications. Memory totals follow `/proc/meminfo` and include the kernel's available-memory estimate.

Select a process, then **End task…** to review the confirmation. **End task** sends SIGTERM; **Force stop** sends SIGKILL and may lose unsaved work. Only processes belonging to the current non-root user can be stopped. PID 1, the monitor and its ancestors, and labwc are protected. A Linux pidfd and process start time prevent signalling a replacement process after PID reuse. There is no privilege escalation. Kernels or Python runtimes without pidfd support can monitor processes but cannot stop them through this UI.

Validation: `npm run build`; `python3 tests/processes.test.py` as a Linux desktop user; `GDK_BACKEND=wayland gjs -m dist/task-manager-test.js`. The Python test stops only its own disposable sleep children.
