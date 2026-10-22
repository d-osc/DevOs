# DevOs QEMU runner

Run from Windows PowerShell with WSL and qemu-system-aarch64 installed. No virtual disk is created from a physical Windows drive.

```powershell
# Automated console boot test (already built by distro.ps1 base)
.\qemu.ps1 base -Test

# Interactive console; exit with Ctrl+A then X
.\qemu.ps1 base

# Graphical desktop, once the complete desktop image exists
.\qemu.ps1 desktop

# Check files without starting a VM
.\qemu.ps1 desktop -Check

# Automated kernel/systemd graphical-target/greeter boot smoke test
.\qemu.ps1 desktop -Test -Timeout 180
```

The base test validates artifact hashes, inspects the initramfs, boots the DevOs kernel, checks the guest init success marker and clean poweroff. The desktop boot test checks the kernel release, systemd graphical target and greeter startup markers, then stops QEMU. It does not test desktop interaction, login, rendering or application behavior.

Desktop mode uses an ARM64 DevOs Image and an ext4 DevOs rootfs. A read-only debugfs check verifies the OS identity and matching kernel-module directory before starting QEMU. Install e2fsprogs in the WSL build host if debugfs is unavailable. QEMU uses a temporary snapshot for all desktop disk changes, so installations and other guest edits are discarded when the VM exits. Rootfs must be a regular file, not a block device. User-mode networking requires no tap device or administrator access; the runner sets no incoming host port forwarding. TCG emulation is used without requiring nested virtualization.

The desktop runner uses a 2D virtio GPU and adds `devos.renderer=pixman` to the
guest command line. DevOs greeter and desktop sessions use Pixman software
rendering for this mode, avoiding accelerated EGL on the TCG display device.
The greeter belongs to `seat`, `video`, and `render` for device access via seatd.

On the 2026-10-22 Live image with kernel `7.3.0-rc6-devos-x2`, the VirtIO GPU
fails to start labwc with `Failed to get DRM object 36 properties: Invalid argument`.
For an interactive Live VM, use `-device bochs-display` instead of
`-device virtio-gpu-pci`, retaining `devos.renderer=pixman`. This configuration
was checked through the guest session log and a QEMU screenshot showing the
desktop and working Terminal. The headless Live boot test passes separately;
it does not validate the graphical DRM device. Physical USB was not written.

Default locations:

- Console: `/var/tmp/devos-base/output/`
- Desktop: `/var/tmp/devos-oe/build/tmp/deploy/images/qemuarm64/`
- Serial logs: `build/qemu/`, with UTC timestamps ending in Z

Create missing artifacts with `./distro.ps1 base` or `./distro.ps1 desktop-build`. No automatic build is performed when starting QEMU. A missing desktop image is reported with the build instruction instead of substituting the console image.

```powershell
.\qemu.ps1 desktop -Memory 4096 -Cpus 4
.\qemu.ps1 desktop -Headless
.\qemu.ps1 desktop -ImageDirectory /var/tmp/devos-apps-oe/build/tmp/deploy/images/qemuarm64
.\qemu.ps1 desktop -Kernel 'C:\images\Image' -Rootfs 'C:\images\devos.ext4'
.\qemu.ps1 base -Test -Log 'C:\Users\ondev\Projects\DevOs\build\qemu\console.log'
```

Memory is in MiB (base default 512; desktop default 4096), CPUs default to 2. Windows and absolute Linux paths are accepted for image and log options. `-BuildDistribution` selects the WSL build host. Native Linux users can run `d distro/qemu.dev -- base --test` or `d distro/qemu.dev -- desktop` with the DevLang runtime in `PATH` or at `~/.local/bin/d`. Manual graphical mode needs WSLg/a usable graphical display. Headless mode provides serial access; it does not open a desktop viewer.

Validation: `python3 tests/qemu-runner.test.py` and `.\qemu.ps1 base -Test`. Desktop command construction, kernel identity, boot-marker parsing and mismatched-module rejection are covered by unit tests. An actual desktop boot remains dependent on a completed native desktop image.

Native desktop regressions also require interaction checks: enter Guest,
verify panel/application icons, confirm Log out, verify the greeter returns,
and repeat. Boot markers alone cannot detect a crashed GJS supervisor behind
a running compositor. The signal helper supports both GLibUnix GIR names
(`signal_add` and `signal_add_full`) used by the native image and build host.
The shell explicitly depends on `librsvg-gtk` as well as Adwaita so GTK can
decode SVG icons; installing the theme without its pixbuf loader is insufficient.
