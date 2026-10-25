# ASUS Glymur Embedded Controller

Upstream GPL-2.0-only driver by Konrad Dybcio, v4, 2026-10-15:

- [Driver and PM callbacks](https://lists.openwall.net/linux-kernel/2026/10/15/949)
- [UX3407NA device tree and wakeup source](https://lists.openwall.net/linux-kernel/2026/10/15/964)
- [Upstream UX3407NA test report](https://lkml.iu.edu/2610.2/12015.html)

The patches are preserved as published (mail addresses are redacted by the
mailing-list mirror). `distro/usb/prepare-suspend-fixes.dev` verifies their hashes,
builds the unmodified driver against the exact kernel Image/config/Module.symvers,
and patches a private board DTS. It creates a new bundle without changing the
original kernel source, Image, or bundle. The module has normal OF aliases and
is loaded by udev when the board's I2C controller enumerates the EC.

This fixes missing EC standby enter/exit notifications. Actual suspend/resume
with this Dev OS image still needs testing on the laptop; a QEMU boot cannot
verify the physical EC, USB controller or display power sequencing.
