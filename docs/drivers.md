# Linux driver audit

Dev OS is a desktop environment. Drivers and firmware come from the host Linux
kernel and distribution. The audit requires Python 3 but works before building
the desktop or installing GJS. It is included in installed and release `bin/`.

```sh
sh bin/dev-os-shell drivers
sh bin/dev-os-shell drivers --json
sudo python3 bin/dev-os-drivers --fix
```

On Windows use `.\dev.ps1 drivers` to inspect Ubuntu in WSL. This cannot inventory
physical hardware hidden by Windows/WSL. On a physical Linux installation, run
the same audit there to get that machine's actual hardware IDs and bindings.

The report inspects PCI, USB interfaces, VMBus, virtio and HID through sysfs:

| Status | Meaning / action |
| --- | --- |
| bound | Kernel driver attached, including built-in drivers; still test the device |
| core-managed | USB parent or PCI bridge; a separate function driver may be unnecessary |
| optional-host-channel | Known Hyper-V IMC channel; no desktop driver repair needed |
| loadable | Kernel alias resolves to installed modules; `--fix` can request loading |
| unresolved | No matching module resolved; inspect kernel logs, firmware, kernel configuration and vendor support |
| needs-review | Missing modalias or modprobe; insufficient evidence to claim a missing driver |
| not-exposed / not-detected | No visible hardware; does not imply a missing driver |
| missing-tool | Device present but its desktop control tool is absent |
| backend-unavailable | Audio control command cannot access a default output |

`--fix` requires root and runs `modprobe --use-blacklist` only for installed
modules resolved from unbound device aliases. It then rescans bindings; a
successful command without a binding is reported as `not-bound`. It never
unloads drivers, overrides blacklists, installs packages, or builds vendor code.
Exit status: 0 means no issues identified within audit scope, 1 means review or
repair remains, 2 means invalid usage/environment. JSON includes repair outcomes.

On a Live USB boot the report also has a `hardware_profile` section: the profile
selected for this machine (`/run/devos-hw`, see [hardware-profiles.md](hardware-profiles.md)),
its test status and quirks, and checks that the profile's `firmware.list`
entries exist, its `modules.load` modules are loaded and blacklisted modules
are not. Missing firmware or an unloaded module counts as an issue (exit 1).
Without a boot-time selection the section is `not-selected` and has no effect.

Optional desktop tools on native Linux: NetworkManager (`nmcli`) for Wi-Fi,
BlueZ (`bluetoothctl`) for Bluetooth, WirePlumber (`wpctl`) or PulseAudio tools
(`pactl`) for audio. Install the appropriate distribution packages only when
the corresponding device exists. Firmware package names depend on hardware and
distribution; an unresolved alias alone cannot identify a firmware failure.

WSLg supplies audio and graphics integration. Windows manages the host GPU and
network hardware; Linux NetworkManager cannot control a Windows Wi-Fi adapter
that WSL does not expose. A custom Linux driver cannot add that host interface.

This audit does not prove complete hardware support: platform/ACPI devices,
firmware logs, suspend/resume, acceleration, microphone capture, connection
management and real input/output require separate hardware testing.

Sources: [Linux sysfs](https://www.kernel.org/doc/html/latest/filesystems/sysfs.html),
[WSLg setup](https://learn.microsoft.com/windows/wsl/tutorials/gui-apps),
[Hyper-V IMC channel, KB 2925727](https://learn.microsoft.com/troubleshoot/windows-server/virtualization/unknown-device-vmbus-virtual-machine).

Tests: `python3 tests/drivers.test.py` (synthetic sysfs; no module loading).

The audit runs in DevLang (`d` 0.5.5+); shared modules from `lib/` must be installed
alongside the command. Its test harness remains Python and invokes the real
DevLang runtime against synthetic sysfs trees and private command fixtures.
