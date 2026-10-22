# Independent DevOs Live USB (ARM64)

This path uses the OpenEmbedded DevOs rootfs, DevOs kernel and exact matching
modules. It does not use the legacy Ubuntu-based ISO under `tools/live/`.
QEMU tools remain available separately.

```powershell
# Kernel bundle already built in this workspace; rebuilding is optional.
.\live-usb.ps1 kernel
# Collect only local board DSP firmware from the installed Windows drivers.
.\distro\usb\stage-x2-firmware.ps1
.\live-usb.ps1 prepare -FirmwareDirectory /mnt/c/Users/ondev/Projects/DevOs/build/live-usb/firmware
.\live-usb.ps1 build
.\live-usb.ps1 check
.\live-usb.ps1 export
```

Default staging directory: `/var/tmp/devos-usb/x2-live` in WSL. Preparation refuses
to overwrite that directory. Use `-OutputDirectory /var/tmp/devos-usb/new-stage`
for a new snapshot. It builds a static ARM64 BusyBox using the independent base
toolchain (`distro.ps1 base` must have prepared that toolchain).

The staging bundle contains `Image`, `rootfs.ext4`, `initramfs.cpio.gz`,
`os-release`, and SHA-256 hashes in `manifest.json`. The copied filesystem gets
a fresh UUID. The initramfs mounts only that UUID, read-only with journal replay
disabled, and uses an overlay in RAM. Session changes are discarded on reboot.
It loads modules from the image, never the WSL kernel. No physical disk is written.

New Live bundles automatically start the desktop as `root`, without a password
prompt, using greetd's initial session. The Live initramfs installs this profile
only in its RAM overlay and writes a boot marker under `/run/devos-live`.
The base rootfs keeps its locked root password and ordinary greeter config.
Logging out returns to the usual greeter; rebooting the Live USB starts root
again. Startup output is available in `/run/devos-live/root-session.log`.

Verify the root desktop and unchanged base login settings with:

```sh
d tools/test/live-usb-boot.dev -- --staging /var/tmp/devos-usb/x2-root-live-diagnostic --desktop-check --timeout 180 --log /var/tmp/devos-live-root-desktop-test.log
```

This uses USB storage in QEMU. A temporary test initramfs uses a headless Wayland
backend to check that both the compositor and ready desktop shell run with UID 0,
independently of the board kernel's virtual GPU support. Its diagnostic service
and headless override are never included in the production image. Native display
support still requires hardware testing.

The kernel bundle defaults to `/var/tmp/devos-kernel-x2/bundle`; override it with
`-KernelBundle`. The Windows export is `build/live-usb/devos-live-arm64-ux3407na.img`
with `SHA256SUMS` and `candidate.json`. Export refuses to overwrite the image.

## ASUS Zenbook A14 UX3407NA / Snapdragon X2 profile

DevOsLinuxKernel now has an optional `scripts/build-snapdragon-x2.sh` profile and
`config/profiles/snapdragon-x2.config`. The default 7.2.11 build remains unchanged.
The X2 profile builds `7.3.0-rc6-devos-x2` and the exact UX3407NA board DTB from
[pinned Linux source with Ubuntu Concept Qualcomm patches](https://ppa.launchpad.net/ubuntu-concept/x1e/ubuntu/pool/main/l/linux-qcom-x1e/).
The profile verifies archive SHA-512 and every cached source file, builds the
kernel/modules/DTB together, and records hashes and provenance in its bundle.
No Ubuntu rootfs or package manager is used in the target image.

The initial workspace build reused verified source/object caches from
`/var/tmp/devos-live-build` with `DEVOS_X2_ARCHIVE`, `DEVOS_X2_SOURCE`, and
`DEVOS_X2_BUILD`. A fresh `kernel` invocation uses a separate build directory.

Preparation installs matching X2 modules into a private copy of the independent
DevOs ext4 image. OEM DSP firmware can be staged from this machine's Windows
Driver Store; only allowlisted `.mbn`, `.elf`, and `.jsn` files are accepted.
Keep that device firmware local for personal testing. No Windows DLL/SYS files
are included. Firmware provenance and hashes are recorded separately.

`imageReady: true` means the boot components have been integrated. Physical
hardware validation is still pending, so `hardwareReady` remains false. The
image is an **experimental boot candidate**, not a certification of device
support. Wi-Fi/BT calibration, audio and suspend still require native testing.

The builder creates a GPT `.img` with a FAT EFI system partition and the DevOs
ext4 partition. `check` validates image hashes, GPT, the root partition bytes,
ARM64 EFI sections, kernel, DTB, initramfs, OS identity and live filesystem UUID.
The unsigned ARM64 UKI uses `EFI/BOOT/BOOTAA64.EFI`; Secure Boot trust/signing must
be addressed before booting it with Secure Boot enabled. Pixman is selected for
the initial software-rendered desktop.

The builder only creates regular image files. Choosing and writing a physical
USB drive is a separate step after a bootable image exists and the target USB
has been identified.

`distro/usb/write-usb.ps1` defaults to validation only. It checks the exported
image hash, selected USB Unique ID/size/name/sector size, and that the source
image lives on another disk. The local `build/live-usb/usb-target.json` records
the selected device. Writing requires explicit `-EraseDisk1` and Administrator
PowerShell; it offlines only the selected USB, writes the image, verifies the
entire image range by reading it back, then brings the USB online. All old USB
data is lost. It creates a checksum receipt and does not write system disks.
Do not run the erase option until the exact USB and data loss are confirmed.
`-VerifyOnly` opens the physical device read-only for a repeat checksum check.
If Windows has relocated the backup GPT to the USB's full capacity, verification
accepts only the primary header CRC, backup-header LBA and last-usable LBA changes;
it validates those bounds and CRC and records both raw and normalized hashes.

After successful USB read-back verification, shut down and open the ASUS boot
menu by holding Esc while powering on, then select the UEFI USB entry. See
[ASUS's boot-menu instructions](https://www.asus.com/us/support/faq/1013017/).
The image is unsigned; firmware must permit unsigned boot. Actual hardware
booting is a user-performed test, not established by image/USB checksum checks.

Tests: `python3 tests/live-usb.test.py` cover initramfs encoding, device nodes,
OS identity, checksums, firmware allowlisting, ARM64 EFI and blocking image
generation when board inputs are missing.

## Diagnosing a native boot that does not reach the GUI

`live-usb.ps1 diagnose` makes a separate staging directory with `-diagnostic`
appended to the selected `-OutputDirectory`. It preserves the original kernel,
DTB and rootfs, updates static boot tools/initramfs and adds visible numbered
boot checkpoints. USB discovery runs independently of driver probing, with a
120-second wait limit and per-probe timeout.

Build/check/export the resulting directory explicitly, for example:

```powershell
.\live-usb.ps1 build -OutputDirectory /var/tmp/devos-usb/x2-live-diagnostic
.\live-usb.ps1 check -OutputDirectory /var/tmp/devos-usb/x2-live-diagnostic
```

Diagnostic boot uses the UUID of its own EFI partition to save logs under
`DEVOS-LOGS/<boot-id>/`. Early logs include `boot.log`, `probe.log` and
`kernel.log`; after systemd starts, a five-minute collector also saves kernel,
greetd/seatd/logind service logs and their status. It writes only this USB's
EFI partition; the OS root remains read-only beneath the RAM overlay.

Logs are available only after the kernel/initramfs can access the USB. If none
are created, record the last visible checkpoint or photograph the Linux output.
The diagnostic candidate improves boot visibility; it does not establish that
the native hang or GUI failure has been resolved. Boot-time logs intentionally
change EFI filesystem contents, so image-wide read-back verification applies
before the first diagnostic boot.

New diagnostic candidates also enable `initcall_debug` and a 4 MiB kernel
log buffer. A photograph of the last `calling`/`returned` lines can identify
which kernel initialization step stopped when USB logging is unavailable.
The X2 kernel profile now builds the foundational Glymur clock, interconnect,
pin control, CPUCP mailbox and AOSS drivers into the kernel. Existing staged
images keep their original kernel; rebuild the kernel bundle and prepare a
new staging directory to use the changed profile. Hardware success must still
be confirmed on the UX3407NA.

The static BusyBox must include both `test` and the `[` applet (`CONFIG_TEST1`),
because the live init uses POSIX bracket conditions. Packaging rejects a
BusyBox missing either. Mount options precede positional arguments for the
musl BusyBox option parser.

Test the actual staged kernel, initramfs and read-only disk image before
flashing, on the QEMU virt machine:

```sh
d tools/test/live-usb-boot.dev -- --staging /var/tmp/devos-usb/x2-initfix --storage usb --log /var/tmp/devos-live-boot.log
```

This checks root discovery, the RAM overlay and execution of systemd. It does
not test the native X2 Device Tree, EFI loader, display or USB controller.
USB storage is the default: it exercises loading the USB mass-storage module
from the initramfs. A virtio-only test can pass even when module discovery is
broken. The BusyBox build explicitly sets `DEFAULT_MODULES_DIR=/lib/modules`
and `DEFAULT_DEPMOD_FILE=modules.dep`; enabling modprobe after `allnoconfig`
otherwise leaves these string options empty.

The Live greeter lists **Root (Live USB)** in the user selector. Sign in with
username `root` and password `root`. The initramfs installs a SHA-512 password
hash into the RAM overlay only; the underlying root filesystem password remains
locked. Reboot resets the Live password. Initial root autologin is preserved.

### Applications and wireless diagnostics

Live root sessions launch Chrome and VS Code with `--no-sandbox` and separate
profiles under `/root/.config/devos-live/`. This disables Chromium's process
sandbox in that root Live session. Regular users keep the normal sandbox.
The launchers select `--disable-gpu` when the compositor uses Pixman, and save
startup output in `/root/.local/state/devos/logs/{chrome,vscode}.log`.
Root sessions start the PipeWire sockets and WirePlumber through their user
manager, as normal desktop sessions do.

The diagnostic collector also records PCI/USB devices, loaded modules, rfkill,
NetworkManager, Bluetooth and ALSA card state plus root audio/application logs.
An empty device list is not evidence of working native hardware.

The selected firmware recipe pins linux-firmware revision
`9a80a04181713da7f8187ec928c15160137f3262` and verifies each download. It includes
QCC2072 Wi-Fi plus QCC2072/WCN7850 Bluetooth firmware. On the inspected Windows
hardware, Wi-Fi identifies as `17cb:1112` with subsystem `105b:e14f`. That exact
subsystem entry is absent from the pinned QCC2072 board-2.bin; do not substitute
another board's calibration without a verified upstream mapping and QMI IDs.
The existing X2 board Device Tree also predates the upstream two-speaker and
wireless power-grid corrections. Native wireless/audio operation remains
unverified until boot logs and the matching board data are available.
Upstream references: <https://patchew.org/linux/20260915-zenbook-dts-v2-0-41de8669a7a8@oss.qualcomm.com/>,
<https://github.com/linux-msm/audioreach-topology/pull/78>,
<https://github.com/alsa-project/alsa-ucm-conf/pull/858>.

### UX3407NA fixes from the first physical boot logs

The captured boot `388ff3ce-70c1-4289-a4c0-5acc1b15f9c8` identified:
- QCC2072 PCI `17cb:1112`, subsystem `105b:e14f`, QMI chip 33 / board 255,
  variant `UX3407Q`: board-2.bin has no matching entry.
- Missing `qcom/glymur/GLYMUR-ASUS-Zenbook-A14-UX3407NA-tplg.bin`, preventing
  ALSA card creation (the volume UI therefore had no real sink).
- The WCN7850 Device Tree compatible requested nonexistent `hmtbtfw11.tlv`
  for the installed C7700 controller (SOC 0x40292100 / ROM 0x0101).
- Missing `qcom/gen80100_sqe.fw` and a Mesa build without Freedreno.

`stage-x2-firmware.ps1` now checks the installed OEM INF mapping for this exact
PCI subsystem and stages `bdwlan_qcc2072_1p0_ncm820A.elf` as ath12k's board.bin
fallback. The kernel detects ELF board data and sends it as ELF to QMI; the
firmware validator accepts only this exact `.bin` path with ELF magic. This is
local device calibration, not an invented mapping to another card's board-2 entry.
Keep the old DSP-only firmware bundle unchanged and stage into a new directory.

`prepare-board-fixes.py` compiles the pinned board source plus
`ux3407na-audio.dtsi` into a new private kernel bundle. It keeps the verified
kernel source and previous bundle unchanged, corrects the two-speaker wiring
from the upstream v2 board description and explicitly selects
`qca/ornnv11.bin` and `qca/ornbtfw11.tlv` for Bluetooth. It requires the built
kernel Device Tree compiler via `--dtc`. Native hardware confirmation is still
required; QEMU cannot validate the X2 codec, Wi-Fi calibration or panel.

The image adds the board's AudioReach topology and pinned upstream UCM files,
Qualcomm GPU firmware and coreutils (including `timeout`). Live sessions retain
the existing Pixman/software rendering fallback; this revision does not enable
GPU acceleration for Chrome or VS Code.
The panel has a real sysfs backlight slider and the standard brightness/volume
keys are bound. A missing kernel backlight remains unavailable instead of being
simulated with a dark overlay.

Three-finger swipe down sends the idempotent `overlays-hide` command to dismiss
Task View and Applications; outside overlays it retains the existing minimize behavior. Editor asset reads now use
GIO asynchronous I/O with paused Soup responses, so reading Monaco assets from
cold USB storage does not block GTK. Session launch output goes to user logs;
Live boot diagnostics remain in the kernel journal, with routine console output
suppressed and the VT cleared before the login compositor starts.

The subsequent physical boot `c81a03a9-2037-4302-8d2b-206ce3003ad6` enumerated
`wlan0` in NetworkManager with no radio block. It also reported a missing
`regulatory.db`. The image now installs `wireless-regdb-static` (database and
signature); it does not force a country code. The Wi-Fi settings bridge now
resolves its installed helper from PATH instead of a source-only runtime path,
and retains backend errors instead of showing JSON parser exceptions.
Bluetooth firmware properties use bare filenames: this kernel's btqca driver
prepends `qca/` itself. Keeping that prefix in the property caused a duplicated
`qca/qca/` request in the captured log.
