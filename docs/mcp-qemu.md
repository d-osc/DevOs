# QEMU VM control for Claude (MCP)

`tools/mcp/qemu-vm/server.ts` is a dependency-free MCP server (stdio) that lets
Claude start, watch and drive ARM64 QEMU VMs of DevOs images. The repo-level
`.mcp.json` registers it as `devos-qemu`; Claude Code asks for approval the
first time the project is opened. It needs Node.js 22.18+/24 (runs the `.ts`
directly), and `qemu-system-aarch64` + `python3` on the Linux side. On Windows
every Linux command goes through WSL (`DEVOS_WSL_DISTRO`, default `Ubuntu`).

| Tool | Purpose |
| --- | --- |
| `vm_start` | Start a VM: preset `desktop` (OE `devos-image`, kernel and newest ext4 auto-detected), `base` (console initramfs) or `live` (UEFI ISO). Optional `memory_mb`, `cpus`, `display` (`none`/`gtk` WSLg window), `gpu` (`virtio`/`bochs`), `image_dir`, `kernel`, `rootfs`, `initrd`, `iso` |
| `vm_list`, `vm_status` | Run state of VMs |
| `vm_control` | pause, resume, reset, ACPI powerdown |
| `vm_stop` | Quit (default) or powerdown |
| `vm_screenshot` | Guest display as PNG |
| `vm_type`, `vm_key`, `vm_mouse` | Keyboard text (US layout), key chords such as `ctrl-alt-f3`, absolute pointer clicks |
| `vm_serial_log`, `vm_serial_send` | Read / write the serial console (`ttyAMA0`) |
| `vm_qmp` | Allow-listed QMP commands only (`query-*`, stop/cont/reset, input events) |

Behavior and limits:

- The root disk uses `snapshot=on` like `qemu.ps1`; guest changes are discarded
  when the VM stops. Live ISOs are read-only. No host block device is ever opened.
- No host port forwarding; networking is QEMU user mode.
- Per-VM state (QMP socket, serial socket and log, pid) is in
  `/tmp/devos-mcp-qemu/<name>/` inside WSL with mode 700.
- `vm_type`, `vm_key` and `vm_mouse` need the USB keyboard/tablet, which the
  `desktop` and `live` presets provide; the `base` console preset has none, use
  `vm_serial_send` there.
- Guest screen and serial text are untrusted data and never instructions.
- VMs are daemonized and keep running if the MCP server exits, but on Windows a
  WSL distro may idle-stop without an open session; the server holds one while it runs.
- Images are not built here; use `.\distro.ps1 base` / `desktop-build` first.
  A graphical desktop boot under TCG takes minutes; poll `vm_serial_log`.
