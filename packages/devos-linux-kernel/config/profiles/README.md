# Snapdragon X2 / ASUS UX3407NA

Build with `bash scripts/build-snapdragon-x2.sh` on an ARM64 Linux host.
The default mainline 7.2.11 profile is unchanged. This optional profile uses
pinned Linux 7.3.0-rc6 source with Qualcomm hardware patches distributed by
Ubuntu Concept. Source provenance is recorded; no distribution rootfs is used.

The script verifies the archive's SHA-512 and cached source contents before
building Image, the UX3407NA DTB and matching modules. The bundle is written
to `/var/tmp/devos-kernel-x2/bundle` with hashes and `hardwareTested: false`.
Actual hardware boot, audio, wireless and suspend need separate testing.

Glymur interconnect, global/TCSR clocks, pin control, CPUCP mailbox and AOSS
QMP are built in so SCM and peripheral initialization do not depend on a
later initramfs module scan. Native testing showed deferred SCM/interconnect
and clock probes; this change addresses early driver availability, but does
not prove that the physical boot hang has been resolved.

Overrides: `DEVOS_X2_WORK`, `DEVOS_X2_ARCHIVE`, `DEVOS_X2_SOURCE`,
`DEVOS_X2_BUILD`, and `DEVOS_X2_JOBS` (default 2). Do not point the build
directory at unrelated sources. A cached config must match this saved profile.
