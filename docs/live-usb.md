# Independent DevOs Live USB (ARM64)

## Release script: build and write the Live USB in one command

`tools/live/release-live-usb.ps1` replaces the manual sequence (OE build, `live-usb.ps1
prepare/diagnose/build/check/export`, `run-write.ps1`). It only orchestrates the existing
scripts, so their safety checks are unchanged. Run it from the project root in Windows
PowerShell 5.1. It never starts unless you pick stages, and `-DryRun` prints every command
without executing anything.

Stages, in order: `Test`, `Kernel`, `Image`, `Prepare`, `Build`, `Check`, `Export`,
`QemuCheck`, `Write`. `-All` runs Test, Image, Prepare (prepare + diagnose), Build, Check,
Export and QemuCheck, then **stops before the write**. Kernel runs only with `-IncludeKernel`
(or `-Stage Kernel`). Every stage logs to `build/live-usb/<stage>-<label>-<time>.log`
(`image-`, `prepare-`, `qemu-` ...), and a summary table shows status, duration, logs and the
image SHA256. It stops at the first failure and prints the `-From <Stage>` command to resume.

```powershell
# See exactly what would run (safe, runs nothing)
.\tools\live\release-live-usb.ps1 -All -DryRun -Label camera

# Full build, stop before writing; the USB is validated and the confirmation text is printed
.\tools\live\release-live-usb.ps1 -All -Label camera -KernelBundle /var/tmp/devos-kernel-x2/bundle-camera-ready-20261024

# Resume after a failure (the staging directory of the last Prepare is remembered in
# build/live-usb/release-state.json); skip slow or unwanted stages
.\tools\live\release-live-usb.ps1 -From Check
.\tools\live\release-live-usb.ps1 -All -Skip Test
.\tools\live\release-live-usb.ps1 -Stage Prepare,Build,Check,Export -Label profile

# Kernel/DTB changed (slow); optional UNVERIFIED camera candidate graph (off by default)
.\tools\live\release-live-usb.ps1 -All -IncludeKernel -CameraCandidate -Label camera
```

Which stages a change needs:

| You changed | Stages |
| --- | --- |
| Shell / TypeScript / apps / systemd units in the rootfs | `Test`, `Image`, `Prepare`, `Build`, `Check`, `Export`. Rebuilding only `dist` is not enough: the shell payload is in the OE rootfs, so `Image` must run (it is incremental, finished BitBake tasks are cached). |
| Kernel, DTB, kernel modules, camera candidate | add `Kernel` (`-IncludeKernel`, `-CameraCandidate`) before `Image`/`Prepare` |
| Hardware profiles, initramfs/init, USB tools (`distro/usb`, `profiles`) | `Prepare`, `Build`, `Check`, `Export` (no OE build) |
| Only want to re-flash the existing image | `-Stage Write -Write` |

`Prepare` always uses a new staging directory `/var/tmp/devos-usb/x2-<label>-<time>` (never
reused) and, by default, the diagnostic variant (`-Diagnostic $true`), so the image keeps writing
`DEVOS-LOGS` on the ESP; pass `-Diagnostic $false` for a plain image. Firmware comes from
`live-usb.ps1`'s own selection (`firmware-oem-wifi-verified`, then `firmware`) unless
`-FirmwareDirectory` is given; pass `-KernelBundle` for a specific bundle (otherwise
`live-usb.ps1`'s default bundle is used). `Export` first **moves** an existing image to
`build/live-usb/before-<label>-<time>-devos-live-arm64-ux3407na.img` (with copies of
`SHA256SUMS` and `candidate.json`); nothing is deleted or overwritten, and if the export fails
the image is moved back. `Image` refuses to start if `pgrep -a bitbake` finds a running build.
`QemuCheck` runs `tools/test/live-usb-boot.dev` headless (`-QemuTimeout`, default 180 s) and is
skipped with a message if `qemu-system-aarch64` or `d` is missing in WSL.

### Writing the USB

`Write` is validation only unless you add `-Write`. It lists the connected USB disk (number,
name, size, partitions and labels), requires **exactly one** USB disk, refuses boot/system or
read-only disks and anything that is not Disk 1 (the writer only ever writes Disk 1), and
refuses a disk whose UniqueId differs from `build/live-usb/usb-target.json`.

```powershell
# Validate and show the target and the exact confirmation text (changes nothing)
.\tools\live\release-live-usb.ps1 -Stage Write

# Write: you type the printed text, e.g. ERASE DISK 1 SanDisk Cruzer Force 14.3 GB
.\tools\live\release-live-usb.ps1 -Stage Write -Write

# Unattended: pass the exact text instead of typing it
.\tools\live\release-live-usb.ps1 -Stage Write -Write -ConfirmErase 'ERASE DISK 1 SanDisk Cruzer Force 14.3 GB'

# A different USB than the recorded one: re-record deliberately (typed confirmation, then the write confirmation)
.\tools\live\release-live-usb.ps1 -Stage Write -Write -RecordTarget
```

If PowerShell is not elevated, only the write step is relaunched with `Start-Process -Verb RunAs`
(approve the UAC prompt). The elevated wrapper runs `run-write.ps1 -EraseDisk1` and then
`run-write.ps1 -VerifyOnly` (full read-back), copies the logs to
`build/live-usb/usb-write-<label>-<time>-*.log`, and the script prints the tail of
`usb-write.log` and the receipt (`Result`, `BytesVerified`, `SHA256`). Removable media is not
set offline; the writer locks and dismounts the USB volumes natively.

After booting on the laptop, read the diagnostic logs back with
`.\tools\live\fetch-usb-logs.ps1` (`-Check` first, then from an Administrator PowerShell).

Time and space: a warm OE rebuild after a small change takes minutes; a cold or kernel-affecting
rebuild can take hours. The exported image is about 5 GB and exists in WSL staging, in
`build/live-usb`, and as `before-*` archives, so keep tens of GB free on the Windows drive and in
WSL (`/var/tmp`; the script warns below 25 GB). If WSL does not start (timeout), run
`wsl.exe --shutdown` and retry. Tests: `tests/live-usb-release.test.py` (parser, dry-run order,
confirmation and identity refusals against a fake disk inventory, image archiving).

## Follow-up: boot e11ceb73 and QEMU software regressions (2026-10-24)

Logs copied read-only to `build/live-usb/hardware-logs-20261024-125208`.
No image was built or USB flashed during this diagnosis.

- Native Bluetooth scanning found 13 devices. Settings used short-lived
  `busctl StartDiscovery`, losing its discovery owner immediately. Settings now
  holds a GIO connection through discovery, reads results before StopDiscovery,
  and releases on error or closing Settings. It no longer calls the CLI scan branch.
- Hotspot reaches `AP-ENABLED`, then dnsmasq fails to bind 10.42.0.1 because the
  listening port is in use. The dnsmasq recipe now disables its standalone
  systemd/SysV service, retaining the binary for NetworkManager's own process.
  When activation objects disappear, the worker now reports Device.StateReason
  and deletes its failed profile instead of surfacing UnknownMethod.
- Camera modules and DTB booted, but CAMSS reports `csiphy0 not found`. The pinned
  driver requires named PHYs; the DTS only supplied graph endpoints. A compatibility
  patch adds three Glymur resources (hardware IDs 0,1,4), mapped to array indexes
  0,1,2. The DTB now supplies `phys`/`phy-names` and maps the PHY4 CAMSS endpoint
  to index 2. This does not alter sensor GPIOs, voltages or rails. The new compiled,
  ABI/DTB/checksum-checked bundle is
  `/var/tmp/devos-kernel-x2/bundle-camera-phy-20261024`. Use it for the next camera
  image instead of the older `bundle-camera-ready-20261024`. Native probe, preview
  and JPEG capture are still unverified.

QEMU log: `build/live-usb/qemu-device-regressions-20261024.log`. Passed desktop
boot, Bluetooth controller protocol, GIO discovery lifecycle (private BlueZ test
service), and real dnsmasq duplicate-port/recovery tests on guest loopback 1053.
The previous image ran in a disposable snapshot with current test fixtures
injected in its test initramfs. This does not claim a new OE image was built.

Host inventory: PCIe Wi-Fi, UART Bluetooth, ACPI/MIPI camera. None is a USB device
exposed to this Windows/WSL QEMU host. No USB radio or camera is attached for real
passthrough, so no physical scan/AP-client/camera-frame test was possible in QEMU.
See [QEMU usb-host](https://www.qemu.org/docs/master/system/devices/usb.html) and
[WSL USB/IP](https://learn.microsoft.com/en-us/windows/wsl/connect-usb).

## Follow-up: boot cdfe85bb (2026-10-24)

Evidence copied read-only to `build/live-usb/hardware-logs-current-20261024`:

- Bluetooth firmware and adapter work; `bluetooth-scan-37.txt` reports 18 distinct
  devices. Settings used `list` instead of the helper's `get`, then tried to read
  adapter/device lists outside the `{ok,state}` envelope. Both protocol mismatches
  are fixed and covered by CLI and GJS controller tests.
- Hotspot driver supports AP, NetworkManager sees it, dnsmasq and netfilter are
  present. No activation was logged; the old GIO bridge discarded the native error
  and labelled every failure as authorization. Errors now retain the native reason,
  redact raw/JSON-escaped passwords, and save a redacted last Settings error for
  `devos-hotspot-report`. Activation allows 30 s and uses explicit WPA2/RSN/CCMP
  with PMF disabled. libnm parses and verifies the profile. Real AP start is still
  unverified; the firmware regulatory timeouts remain in the native log.
- Camera has no sensor, CCI or CAMSS graph and no video/media nodes. The compiled
  camera bundle is `/var/tmp/devos-kernel-x2/bundle-camera-ready-20261024`, including
  patched CAMSS, PM8010 MFD and regulator modules, matching symbol ABI, the candidate
  board DTB and preserved EC/audio fixes. See
  `native/kernel/ux3407na-camera/README.md`. The board wiring remains a community
  candidate, not a successful physical capture test.

These changes need a new desktop build and fresh Live USB staging. For a camera
test use `-KernelBundle /var/tmp/devos-kernel-x2/bundle-camera-ready-20261024` when
preparing; the previous stock bundle cannot enumerate this camera. No new full
image or USB write was performed as part of this follow-up.

## Recover missing staging / missing exported image

Changing `$stage` to `"$stage-diagnostic"` does not create the diagnostic
directory. `prepare` creates base staging; `diagnose` creates its diagnostic
copy. Build/check/export need the manifest produced by these successful steps.
Do not move the current image before build and check succeed. Existing `.bak`
images are older backups, not proof that the latest source was built.

For this workspace, run the following in PowerShell from the project root.
Each external step stops on failure. It rebuilds the desktop, composes the audio
DTB fix with the existing EC bundle, prepares complete firmware and exports a
verified image. It does **not** write a USB device. Camera hardware enablement
is still incomplete, even after rebuilding this image.

```powershell
$ErrorActionPreference = 'Stop'
function Invoke-DevOsStep([scriptblock]$Action) {
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "DevOs step failed: $LASTEXITCODE. Stop here." }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$baseStage = "/var/tmp/devos-usb/live-$stamp"
$stage = "$baseStage-diagnostic"
$bundle = "/var/tmp/devos-kernel-x2/bundle-audio-ec-$stamp"

Invoke-DevOsStep { .\distro.ps1 desktop-build }
Invoke-DevOsStep {
    wsl -d Ubuntu --exec d /mnt/c/Users/ondev/Projects/DevOs/distro/usb/prepare-board-fixes.dev -- --source /var/tmp/devos-live-build/linux-qcom-x1e-7.3.0 --bundle /var/tmp/devos-kernel-x2/bundle-suspend-20261023 --output $bundle --dtc /var/tmp/devos-kernel-x2/build-latest-20261023/scripts/dtc/dtc
}
Invoke-DevOsStep { .\live-usb.ps1 prepare -OutputDirectory $baseStage -KernelBundle $bundle }
Invoke-DevOsStep { .\live-usb.ps1 diagnose -OutputDirectory $baseStage }
Invoke-DevOsStep { .\live-usb.ps1 build -OutputDirectory $stage }
Invoke-DevOsStep { .\live-usb.ps1 check -OutputDirectory $stage }

# Only back up the exported image once a replacement has built and checked.
$image = Join-Path $PWD 'build/live-usb/devos-live-arm64-ux3407na.img'
if (Test-Path -LiteralPath $image) {
    Move-Item -LiteralPath $image -Destination "$image.$stamp.bak"
}
Invoke-DevOsStep { .\live-usb.ps1 export -OutputDirectory $stage }
```

Run the block as a whole; after an exception do not manually continue with
export or the USB writer. Export now copies to a private `.partial` file,
verifies its checksum and only then publishes the final `.img` filename.

This path uses the OpenEmbedded DevOs rootfs, DevOs kernel and exact matching
modules. It does not use the legacy Ubuntu-based ISO under `tools/live/`.
QEMU tools remain available separately.

```powershell
# Kernel bundle already built in this workspace; rebuilding is optional.
.\live-usb.ps1 kernel
# For a fresh machine, collect DSP + exact OEM Wi-Fi calibration into a new folder.
.\distro\usb\stage-x2-firmware.ps1 -OutputDirectory .\build\live-usb\firmware-complete
.\live-usb.ps1 prepare -FirmwareDirectory /mnt/c/Users/ondev/Projects/DevOs/build/live-usb/firmware-complete
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

`prepare` grows the copied ext4 by 1 GiB to make room for the kernel modules and firmware and, once every write
is done, shrinks it again to its content plus a 64 MiB margin (`e2fsck`, then `resize2fs -f` to a size computed from the
blocks in use, because `resize2fs -M`/`-P` report the full size for the OE images; the file is cut to the new length and
checked with `e2fsck -fn`). No ext4 feature is added, so the read-only `noload` mount is unchanged. `manifest.json` records
`rootfsShrunk` and `rootfsMarginBytes`, and `check` fails when a shrunk rootfs carries more than the margin (plus 32 MiB)
of free space or is not clean. Nothing writes to `rootfs.ext4` after `prepare`; the `-diagnostic` staging hard-links
the already shrunk file. For debugging, `DEVOS_USB_NO_SHRINK=1` (or `--no-shrink`) keeps the grown file system.
The image went from about 3.2 GiB to about 2.0 GiB.

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

Machine-specific inputs live in `profiles/asus/ux3407na/` (match rules, USB
bring-up modules, kernel arguments, firmware list, lid policy, audio DT patch).
The Live init identifies the machine first and applies the matching profile;
unknown machines get the generic profile. See [hardware-profiles.md](hardware-profiles.md).
The BusyBox build also enables `tr` and `uname`, which the identification step
uses when present; existing BusyBox builds still work with reduced detail.

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
PowerShell; it locks and dismounts every mounted volume on the selected USB,
keeps the locks while writing and verifying the entire image range, then
releases the handles and refreshes Windows storage discovery. This supports
removable drives that cannot be set offline. If a volume is busy, close Explorer,
terminals and apps using that USB and retry; a failed lock prevents writing. All old USB
data is lost. It creates a checksum receipt and does not write system disks.
Do not run the erase option until the exact USB and data loss are confirmed.
If Disk 1 is a different USB from the saved selection, validation displays both
devices and refuses to proceed. After checking the current device, run
`.\distro\usb\write-usb.ps1 -SelectTarget` to save its identity locally, then
run the script without switches to validate it. Selection does not open the
physical disk, erase data or authorize a write; it cannot be combined with
`-EraseDisk1` or `-VerifyOnly`. Boot/system, non-USB, read-only, undersized and
unsupported-sector disks are still rejected during selection.
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

## Installing to the internal disk

From the Live session, **Install Dev OS** erases one chosen internal disk and installs Dev OS on it
(user account, UEFI boot entry). See [installer.md](installer.md). The Live USB image now also carries
`EFI/DEVOS/INSTALLED.EFI`, the boot image the installer copies to the internal disk.

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
Selecting root on the Live greeter shows this password as a hint; the greeter
rejects `root` unless `/run/devos-live/root-session-enabled` exists, so installed
systems (where the installer locks root) never offer it.

#### Greeter power buttons

The login screen has Sleep, Restart and Shutdown buttons at the bottom right.
Restart and Shutdown ask for confirmation (as the panel's power menu does); Sleep
suspends at once, since there is no desktop to lock. They call logind
(`Suspend`/`Reboot`/`PowerOff`) as `devos-greeter`; polkit rule
`50-devos-greeter-power.rules` lets only that user do so, including the
`-multiple-sessions` variants needed while a Live root session is still open.
A button is disabled when logind reports the action unavailable.

Every power request and its outcome is logged with the journal tag `devos-power` (and the
greeter log). The greeter calls logind non-interactively, so a refusal is shown on the
login screen instead of waiting on an invisible authentication dialog. Because the Live
journal is in RAM and the screen is black while suspending or shutting down,
`devos-power-log` (a systemd-sleep hook and `devos-power-log.service`) appends the
suspend/resume and shutdown/restart context (logind and greetd journal, kernel tail after
resume, pending jobs and inhibitors at shutdown) to `DEVOS-LOGS/<boot id>/power.txt` on the log
partition. Read it after the next real test.

Verified in WSL: `tests/os-login.test.tsx` (buttons, confirmation, disabled
state, Live hint) and `tests/greeter-power-polkit.test.py`. Not verified on the
UX3407NA or in a booted image: that the polkit rule loads, that logind accepts the
calls from the greeter session, that Sleep resumes back to the greeter, and the
real-keyboard root login (the previous hardware log from an older image shows the
greeter root login succeeding through `pam_unix`, so the cause of the reported
failure is not reproduced from the code; most likely the password `root` was not
known, which the hint now addresses).

### Applications and wireless diagnostics

The Live image carries no web browser, VS Code, Rust, Node.js or QEMU (an estimated
1.9 GB less than before, to be measured by the next build; see `docs/bundled-apps.md`).
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

The old `build/live-usb/firmware` directory in this workspace contains only DSP
files. Passing that directory dropped the board calibration from subsequent
images, and physical boot `1b311993-d4c3-402c-882e-c2358a0ed7d1` again reported
`failed to fetch board.bin` / `qmi failed to load board data file:-2`, leaving
NetworkManager without a Wi-Fi adapter. The generic `board-2.bin` alone does not
contain the matching subsystem/QMI entry for this card.

Preparation now rejects DSP-only firmware, mismatched PCI/subsystem metadata,
missing OEM INF provenance, altered calibration, and non-ELF `board.bin`.
`live-usb.ps1 prepare` without `-FirmwareDirectory` selects the existing
`firmware-oem-wifi-verified` bundle first, then a complete `firmware` bundle.
An explicitly provided directory is validated rather than silently replaced.
Validation runs before BusyBox compilation or rootfs staging. After copying the
firmware into the private ext4 image, preparation reads back `board.bin` and
checks its hash against the selected input bundle.
Bootable staging from before this correction is rejected by check/build/export
when it lacks the read-back calibration proof; prepare a fresh staging directory
instead of re-exporting an old image.

Firmware validation alone (no image build or USB write):

```powershell
wsl -d Ubuntu --exec d /mnt/c/Users/ondev/Projects/DevOs/distro/usb/prepare.dev -- firmware-check --firmware /mnt/c/Users/ondev/Projects/DevOs/build/live-usb/firmware-oem-wifi-verified
```

`prepare-board-fixes.dev` compiles the pinned board source plus
`ux3407na-audio.dtsi` into a new private kernel bundle. It keeps the verified
kernel source and previous bundle unchanged, corrects the two-speaker wiring
from the upstream v2 board description and explicitly selects
`qca/ornnv11.bin` and `qca/ornbtfw11.tlv` for Bluetooth. It requires the built
kernel Device Tree compiler via `--dtc`. Native hardware confirmation is still
required; QEMU cannot validate the X2 codec, Wi-Fi calibration or panel.

The image adds the board's AudioReach topology and pinned upstream UCM files,
Qualcomm GPU firmware and coreutils (including `timeout`). Live sessions retain
the existing Pixman/software rendering fallback; this revision does not enable
GPU acceleration.
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

### UX3407NA sleep recovery (2026-10-23)

The captured physical boot `1b311993-d4c3-402c-882e-c2358a0ed7d1` ends with
`PM: suspend entry (deep)` and no resume. The board bundle lacked the ASUS EC
driver and EC DT node. The upstream v4 driver sends Modern Standby entry/exit
notifications; the matching A14 DT patch declares its interrupt/wakeup source.
This is a supported correction, not proof that all native resume paths work.

Build a matching corrected kernel bundle without editing the pinned sources:

```sh
d distro/usb/prepare-suspend-fixes.dev -- \
  --source /var/tmp/devos-live-build/linux-qcom-x1e-7.3.0 \
  --build /var/tmp/devos-kernel-x2/build-latest-20261023 \
  --bundle /var/tmp/devos-kernel-x2/bundle \
  --output /var/tmp/devos-kernel-x2/bundle-suspend-20261023
```

Pass that output to `prepare.dev prepare --kernel-bundle` (or
`live-usb.ps1 -KernelBundle`). The hardware profile uses s2idle with no deep
fallback, requires a bound EC before suspend, and saves pre/post sleep logs to
the UUID-selected Live ESP. The installed-system UKI uses the same corrected
DTB and modules. Lid sleep remains disabled pending physical wake testing.
# UX3407NA audio bundle compatibility (2026-10-23)

The previous EC-only bundle lacks the matching ASUS microphone routing.
Future preparation requires a fresh corrected board bundle. The updated
`distro/usb/prepare-board-fixes.dev` preserves EC fixes from its input bundle;
`distro/usb/prepare-suspend-fixes.dev` includes the audio override as well.
Both produce audio provenance checked before image preparation. This source
change does not update existing images or USB media.

## UX3407NA speakers not found (2026-10-23)

Evidence, from `build/live-usb/hardware-sleep-logs-20261023` (physical boot
`1b311993`, an older four-speaker bundle): the ADSP boots, APR/GPR services and
the ASoC card (`GLYMUR-ASUS-Zenbook-A14-UX3407N`, card 0) exist and the AudioReach
topology loads, but WirePlumber logs `Failed to get the verb HiFi` / `No UCM verb
is valid`. The kernel also reports `swrm_wait_for_wr_fifo_avail err write
overflow` and `wsa884x ... Slave 2 initialization failed: -5` on *both*
SoundWire masters (`6c80000` and `6ca0000`). That DTB described four speakers
(`swr0` + `swr3`); the A14 has two WSA8845 on `swr0`, so the second bus polls
amplifiers that do not exist, and the UCM controls `SpkrLeft/SpkrRight ...` do
not match the woofer/tweeter prefixes. Without the HiFi verb PipeWire gets no
Speaker device.

Source fixes already in the tree (not in any built image; the image staged at
22:34 still has the older `${CardLongName}` router): two-speaker DT
(`profiles/asus/ux3407na/kernel/ux3407na-audio.dtsi`, `swr3` disabled), UCM
router matching `${CardName}` (`recipes-multimedia/alsa/files/devos-glymur.conf`;
the long name is rewritten from DMI on the real machine) and the pinned ASUS UCM
files. Needs a new kernel bundle (`prepare-board-fixes.dev`) and image build.

Not available: the later native boot `3367a468` logs, and any `aplay -l`,
`wpctl status` or `alsaucm` output from the A14. No speaker signal has been
verified; QEMU has no X2 audio hardware.

`devos-audio-report` (source `distro/usb/audio-report`, run by the Live
diagnostics collector every minute into `DEVOS-LOGS/<boot-id>/audio-report.txt`)
prints one `AUDIO-CHECK <layer>: ok|FAIL` line each for DSP/topology firmware,
ADSP boot, APR/GPR, GPR command timeouts, topology load, sound card, bound
WSA884x amplifiers, SoundWire errors, UCM HiFi verb and a PipeWire sink, followed
by the evidence (`/proc/asound`, SoundWire sysfs, audio `dmesg`, `alsaucm`,
speaker mixer controls, `wpctl status`).

On the laptop after the next authorized build, boot the Live USB and run:

```sh
devos-audio-report /tmp/audio-report.txt; head -20 /tmp/audio-report.txt
speaker-test -c 2 -t sine -l 1   # audible check, lower the volume first
```

Send back `audio-report.txt` (or the `DEVOS-LOGS/<boot-id>` folder). Reading it:
firmware/ADSP/APR FAIL = firmware staging; `sound-card` FAIL = DT or deferred
probe; `soundwire-bus` or `speaker-amplifiers-bound` FAIL = amplifier
reset/supply/port wiring in the DT (kernel side); `ucm-verb` FAIL with a card
present = UCM routing or missing mixer controls; only `pipewire-sink` FAIL =
WirePlumber/session.

## UX3407NA camera not found (2026-10-23)

Evidence from the physical laptop (`build/live-usb/hardware-sleep-logs-20261023/1b311993`,
and the older `hardware-logs/388ff3ce`, `c81a03a9`):

- `lsusb` lists only the xHCI root hubs and the boot medium (SanDisk / RTL9210
  enclosure). No internal webcam appears on USB, so this laptop's camera is not
  a UVC device. Windows also enumerates Qualcomm Spectra MIPI/ISP devices, not a
  USB camera. `uvcvideo` is irrelevant here.
- No `qcom_camss`, `i2c_qcom_cci`, `ov02c10`, `videodev` or `v4l2` module is
  loaded, `devices_deferred` is empty and `kernel.log` has no CAMSS/CCI/sensor
  line. The only camera mention is a `camera@91a00000` reserved-memory region,
  which reserves RAM but describes no sensor.
- Nothing probes because the board device tree has no camera graph. The pinned
  kernel (Ubuntu Concept 7.3.0-22.22) has OV02C10, CCI and CAMSS enabled in its
  config but lacks the `qcom,glymur-camss` match, the Glymur CAMSS/CSI/CCI nodes,
  PM8010 regulator support and the UX3407NA sensor power/GPIO/CSI graph
  (details: `native/kernel/ux3407na-camera/README.md`).

Root cause class: kernel source and device tree (missing camera graph), not
permissions, packages, early modules or firmware. The Camera app and
`libcamera-gst` are correct; with no media device they correctly list nothing.
Adding modules to `early.modules` or kernel config cannot fix this, so none were
changed. Missing evidence: a `camera-report.txt` or `cam -l` from the A14, and
the verified sensor wiring (reset/power GPIOs, PM8010 rails, CSI lanes), which
neither the A16 DTS nor Windows files establish.

What is fixed now is that the failure is visible. `devos-camera-report` (source
`distro/usb/camera-report`, run by the diagnostics collector every minute into
`DEVOS-LOGS/<boot-id>/camera-report.txt`) prints `CAMERA-CHECK <layer>: ok|FAIL`
for USB video devices, enabled `camss@`/`cci@`/sensor device-tree nodes, the
`qcom_camss`/`i2c_qcom_cci`/`ov02c10`/`uvcvideo`/`videodev` modules, camera probe
errors in dmesg, `/dev/video*`, `/dev/media*`, `v4l2-ctl`, `cam -l`, the
`libcamerasrc`/`v4l2src` GStreamer plugins and a PipeWire video source, then the
raw evidence (`lsusb`, DT nodes, `media-ctl` graphs, camera `dmesg`). It opens no
camera stream. It needs a new image to be present on the USB.

Laptop checklist (after an authorized build with the camera kernel stack):

```sh
devos-camera-report /tmp/camera-report.txt; head -30 /tmp/camera-report.txt
cam -l
```

Reading it: `dt-camss-node` / `dt-cci-node` / `dt-sensor-node` FAIL = kernel
bundle has no camera device tree (the current state); DT ok but `module-*` FAIL
= module missing from the bundle; `kernel-probe-errors` FAIL = regulator, clock,
GPIO or firmware wiring (read the dmesg block); `dev-media` ok but
`libcamera-cam-list` FAIL = libcamera pipeline/SoftISP support; only
`pipewire-video-source` FAIL = PipeWire/portal session. `usb-uvc-device` ok
would mean a USB camera, handled by `uvcvideo`.

Verified offline: script syntax and a fake-sysroot test (`tests/live-usb.test.py`).
Only the real laptop can confirm any camera detection or capture.

## UX3407NA Bluetooth cannot scan or pair (2026-10-23)

Evidence from three physical boots (`build/live-usb/hardware-logs/DEVOS-LOGS/c81a03a9…`,
`microphone-native-20261023/3367a468…`, `hardware-sleep-logs-20261023/1b311993…`):
- The kernel stack is fine: `bluetooth`, `hci_uart` (QCA protocol), `btqca` and
  `pwrseq-qcom-wcn` load; the DT node `qcom,wcn7850-bt` binds and `hci0` appears
  ("setting up wcn7850", product 0x20, ROM 0x0101). rfkill is not blocked,
  `bluetooth.service` runs and `bluetoothctl list` shows a controller.
- Every boot then logs `QCA Failed to request file: qca/<name>.tlv (-2)` followed by
  `unexpected event for opcode 0xfc48`, and bluetoothd logs
  `Failed to set default system config for hci0`. The file names differ per image
  (`qca/qca/ornbtfw11.tlv`, `ornbtfw11.tlv`, `hmtbtfw11.tlv`) — the DT `firmware-name`
  fix moved the request to the right file, but it still failed.
- Cause of the remaining `-2`: the controller is probed during the initramfs USB
  discovery loop (about 3.2 s), before the root filesystem is mounted. btqca asks for
  the patch/NVM once, and `qca/ornbtfw11.tlv` / `qca/ornnv11.bin` were only in the
  rootfs (`devos-x2-wireless-firmware` does install them there; confirmed with
  `debugfs` on the staged images), never in the initramfs `/lib/firmware`. The
  controller is left in ROM state, so scan/pairing cannot work. The `regulatory.db`
  Wi-Fi file hit the same ordering problem and is already staged into the initramfs.

Fixes in the tree (need a new `prepare` + image build + USB write; none was done):
- `prepare.dev` stages the `qca/` entries of the board profile's `firmware.list`
  (`qca/ornbtfw11.tlv`, `qca/ornnv11.bin`, now listed) from the rootfs into the
  initramfs, and fails preparation if they are not in the rootfs. Recorded in the
  stage manifest as `bluetoothFirmwareInInitramfs`.
- `devos-bluetooth-recover` (service `devos-bluetooth-recover`, before
  `bluetooth.service`) re-binds the serdev device once if dmesg shows a failed firmware
  request and the file now exists in the rootfs. This also covers a stage prepared
  without the initramfs files. It does nothing when the first setup succeeded.
- The corrected board bundle (`prepare-board-fixes.dev`, DT `firmware-name =
  "ornnv11.bin", "ornbtfw11.tlv"`) is still required: with the older DTB the driver asks
  for the nonexistent `qca/hmtbtfw11.tlv`, which no recovery can satisfy.

Diagnostics: `devos-bluetooth-report` (source `distro/usb/bluetooth-report`; the
collector writes it every minute to `DEVOS-LOGS/<boot-id>/bluetooth-report.txt`, with
one bounded 6 s scan about a minute after boot) prints `BLUETOOTH-CHECK <layer>: ok|FAIL`
for modules, device-tree node, bound serdev, `/sys/class/bluetooth/hciN`, controller
firmware (names the missing file, and tells apart "missing from image" from "too late"),
firmware files, rfkill, `bluetooth.service`, BlueZ adapter address and power, and scan,
then the raw evidence (`bluetoothctl show`, `btmgmt info`, DT nodes, dmesg, journal).

Laptop checklist (after an authorized build that includes these changes):

```sh
devos-bluetooth-report /tmp/bt.txt; sed -n '/Verdict/,/^$/p' /tmp/bt.txt
dmesg | grep -i -E 'hci0|QCA'          # expect no "Failed to request file"
bluetoothctl power on; bluetoothctl --timeout 10 scan on
```

Reading it: `controller-firmware` FAIL "missing" = file not in the image or wrong DT
name; "before the file was available" = initramfs lacked it (run
`devos-bluetooth-recover`); all kernel layers ok but `scan` FAIL = nothing in range or
RF path/antenna (check with a phone in pairing mode); `bluez-adapter` address
`00:00:00:00:00:00` = NVM not applied. Audio after pairing (A2DP) is a PipeWire step
and is untested.

Verified offline: script syntax, a fake-sysroot test fed with the captured kernel lines,
the recovery rebind, and initramfs staging logic (`tests/live-usb.test.py`). Not
verified: any real controller bring-up, scan, pairing or A2DP; the firmware filenames
are the ones the BT driver requested in the log and match the linux-firmware files in
the recipe, but whether the ROM accepts that patch is only known on the laptop.

### Camera kernel enablement status (2026-10-24)

Established offline (details and sources: `native/kernel/ux3407na-camera/BOARD-EVIDENCE.md`):

- This laptop's ACPI DSDT (exported by `tools/live/export-windows-camera-evidence.ps1`) shows a Spectra
  MIPI camera platform, CCI at `0xac15000`/`0xac16000` (same as `cci0`/`cci1` in the SoC patches), and
  GPIO99 (the `cam_mclk` pin, so MCLK3 is inferred) and GPIO111 (privacy LED). Front sensor: OV02C10, I2C 0x36.
- `snapdragon-x2.config` already enables CAMSS, CCI, OV02C10, PM8008, Glymur CAMCC and the CSI2 PHY, and the
  built modules exist, so **no kernel config fragment is needed**. The built `qcom-camss.ko` only matches
  `qcom,x1e80100-camss` and `qcom-pm8008.ko` has no `pm8010`; the 11 prepared patches fix both and the SoC
  DT patches compile into the A14 DTB (checked with `dtc`, nodes stay disabled). Modules autoload from DT
  matches, so `early.modules` is not involved.
- Still missing and **not guessed**: sensor CCI bus, reset/power GPIOs, PM8010 and CSIPHY supply rails, CSI
  lanes. `profiles/asus/ux3407na/kernel/ux3407na-camera.dtsi` is the guarded slot for them (it fails to
  compile until filled) and is deliberately not applied by `prepare-board-fixes.dev`.

`devos-camera-report` now also prints `kernel-camss-glymur-match`, `kernel-pm8010-match` and `dt-camcc-node`,
so the next boot shows which layer is missing. Even with the patched driver the camera stays absent until the
board graph above exists and a kernel/modules/DTB rebuild (not done) is booted.

## UX3407NA battery shows no percentage / slash icon (2026-10-24)

Symptom: the panel shows a battery-with-slash icon and no percentage, identical
unplugged and while charging.

Panel cause (fixed in the repo): the old indicator asked for `battery-missing` whenever
`/sys/class/power_supply/<battery>/capacity` was unreadable, and the Font Awesome base
icons map `battery-missing` to `battery-slash`. There was no charging variant for an
unknown percentage, so charging looked the same. On this laptop the kernel driver
`qcom_battmgr` (`drivers/power/supply/qcom_battmgr.c`) returns `-ENODATA` for `capacity`
while the firmware has not reported a percentage (`status.percent == -1`), but `status`,
`present` and the energy counters can still be read. The panel now:

- scans every `power_supply` entry, ignores `scope=Device` (mouse/headset) and
  `present=0`, and prefers a battery that reports a percentage;
- falls back to `energy_now/energy_full` (then `charge_now/charge_full`) when `capacity`
  is unreadable;
- shows `NN%` plus the state (`Charging`, `Full`, `Plugged in` for "Not charging"), a
  charging bolt for `status=Charging`, and, if only a status is known, the status word
  with the tooltip "Percentage not reported by the firmware" instead of a slash;
- shows a neutral dimmed "No battery data" state when an AC/USB supply exists but no
  battery does, and hides the indicator on machines with no power supplies at all
  (desktops, VMs);
- re-reads sysfs every 5 s (plain file reads, no process spawns) and re-renders only on change.

Kernel layer, from the real logs (`hardware-logs/DEVOS-LOGS/c81a03a9-…`,
`hardware-sleep-logs-20261023/1b311993-…`, `microphone-native-20261023/3367a468-…`):
`pmic_glink`, `qcom_battmgr`, `ucsi_glink`, `pmic_glink_altmode`, `qcom_pdr_msg` and
`pdr_interface` are loaded; `qcom_pmic_glink pmic-glink` probes; remoteproc `soccp`
attaches ("remote processor soccp is now attached") and `adsp` boots. On Glymur the
battery service is served by SOCCP over the `PMIC_RTR_SOCCP_APPS` rpmsg channel, not by
the ADSP. What the logs do **not** show: any `/sys/class/power_supply` listing,
`upower`/`acpi` output, or an rpmsg device list, and `qcom_battmgr` logs only on errors,
so it is unproven whether `qcom-battmgr-bat` registers on the laptop and whether it
ever reports `capacity`. The Live collector had no power-supply capture before this
change. Candidate kernel causes, in the order `devos-battery-report` tests them: the
SOCCP node lacks a `glink-edge` with the `PMIC_RTR_SOCCP_APPS` channel in the DTB, or
`qcom_glink_smem`/`rpmsg` is not loaded; the aux device `pmic_glink.power-supply.0` is
not bound; the firmware has not reported a percentage yet (the panel handles this).

Diagnostics: `devos-battery-report` (source `distro/usb/battery-report`; the collector
writes it every minute to `DEVOS-LOGS/<boot-id>/battery-report.txt`) prints
`BATTERY-CHECK <layer>: ok|FAIL` for modules, the DT `pmic-glink` node, SOCCP/ADSP
remoteproc state, the `PMIC_RTR_*` rpmsg channel, the bound power-supply auxiliary
device, `/sys/class/power_supply` entries, battery presence/capacity/status, charger
online state, kernel messages, and `panel-would-show`, then the raw attributes.

Laptop checklist (after an authorized build that includes these changes):

```sh
devos-battery-report /tmp/bat.txt; sed -n '/Verdict/,/^$/p' /tmp/bat.txt
ls /sys/class/power_supply; cat /sys/class/power_supply/qcom-battmgr-bat/{status,capacity,energy_now,energy_full}
dmesg | grep -i -E 'battmgr|pmic_glink|PMIC_RTR'
```

Reading it: `rpmsg-channel` FAIL with remoteproc ok = the DTB's SOCCP `glink-edge` does
not carry the PMIC_RTR channel (kernel/DT fix, then rebuild); `aux-power-supply` FAIL =
pmic_glink did not probe; `battery-supply` ok but `battery-capacity` FAIL = firmware
reports no percentage yet (wait, replug the charger, then check again); all ok but the
panel still wrong = send `battery-report.txt`.

### First real camera report (2026-10-24 image, boot `c69b55bf`)

`build/live-usb/hardware-logs-20261024-1017/c69b55bf-…/camera-report.txt` on the A14 confirms the diagnosis:
`dt-camss-node`, `dt-cci-node`, `dt-sensor-node`, `kernel-camss-glymur-match`, `kernel-pm8010-match`,
`usb-uvc-device`, `dev-video`, `dev-media` all FAIL; `dt-camcc-node` and `module-camcc_glymur` are ok
(`camcc_glymur` is loaded); no CAMSS/CCI/OV02C10 line in dmesg; `libcamera` runs and reports an empty camera list
(`gst-libcamerasrc`/`v4l2src` ok); PipeWire has no video source. So that image carries the original kernel
without the patch stack and with no camera graph, as expected. The logs contain no wiring values: the booted
DT is the bundle DTB, which has none. Same result as the 2026-10-23 boot (camera reserved-memory only).

Same boot: `boot.log` says `DEVOS HW: unrecognised machine unknown ... using the generic profile`, `profile:` is
empty and `identity.json`/`selection.json` are empty although DMI is `Zenbook A14 UX3407NA`; the hardware-profile
selection did not match in the initramfs on this image (tracked separately).

### Battery: first real report (2026-10-24, `hardware-logs-20261024-1017/c69b55bf-…`)

The kernel layer is healthy on the UX3407NA. `battery-report.txt` shows every layer `ok`:
`module-pmic_glink`, `module-qcom_battmgr`, `remoteproc: soccp(attached) adsp(running)`,
`rpmsg-channel: PMIC_RTR_SOCCP_APPS` (bound to `qcom_pmic_glink_rpmsg`), `aux-power-supply: 1 bound of 1`,
and `/sys/class/power_supply` holds `qcom-battmgr-bat`, `-ac`, `-usb`, `-wls` plus two
`ucsi-source-psy-*` entries. The battery has `present=1`, `status=Charging`,
`energy_now=68357000`, `energy_full=70857000`, `cycle_count=8`, but **no `capacity` file at all**
(`charge_now/full` return ENODATA); `qcom-battmgr-ac` is `online=0` while `qcom-battmgr-usb` and
`ucsi-source-psy-pmic_glink.ucsi.01` are `online=1` (USB-C charging). So the original "slash, no %"
was the panel only reading `capacity`; with the counter fallback it shows `96% · Charging`
(`tests/panel-battery.test.mjs` runs these exact values). No DT, kernel-config or module-order change
is needed for the battery. The report's `kernel-messages` line only quotes the harmless
`Failed to create device link ... fd5000.phy` lines; the `gcc_usb3_tert_phy_com_aux_clk status stuck at 'off'`
warning in the same boot is a separate USB item.

### First native audio report (boot `c69b55bf`, 2026-10-24)

`build/live-usb/hardware-logs-20261024-1017/c69b55bf-…/audio-report.txt`, from the
image built with the two-speaker DT and the `${CardName}` UCM router:

- Fixed relative to `hardware-sleep-logs-20261023`: the card exists
  (`GLYMURASUSZenbo`, PCMs MultiMedia1 playback / MultiMedia2 capture), UCM lists
  `HiFi` with `Speaker` and `Mic`, all `SpkrLeft/SpkrRight` controls exist, WirePlumber
  creates `alsa_output.platform-sound.HiFi__Speaker__sink` ("Built-in Audio Speaker
  playback", volume 0.40) and the Internal microphones source. `Failed to get the
  verb HiFi` and every `swrm_wait_for_*_fifo_avail`, `Slave 2 initialization failed: -5`
  and `Cannot sync regmap` message are gone; only the two WSA884x on `swr0` remain.
- Unchanged and still unexplained: one `qcom-apm ... CMD timeout for [1001021]`
  (present in both boots, card still binds), and `SWR bus clsh detected`.
- Open: the sink was `SUSPENDED` and both amplifiers read `status=UNATTACHED` while
  idle, and no tone was played, so audible output is not established.
  The report's `sound-card FAIL` in this boot was a bug in the report (`-s` on
  `/proc/asound/cards`, which always has size 0); the card was present. Fixed.
- Separate fault: `boot.log` says `DEVOS HW: unrecognised machine unknown ... using
  the generic profile` and `identity.json`/`selection.json` are empty although DMI
  reports `ASUS Zenbook A14 UX3407NA`. The initramfs hardware identification is not
  working on this image (the profile's early modules, kernel args and lid policy were
  not applied); tracked by the hardware-detection work, not an audio fault.

Next laptop test (no rebuild needed for the script if the image already has
`devos-audio-report`; the updated script with `--play` needs the next image):

```sh
devos-audio-report --play /tmp/audio-report.txt    # 4 s quiet 440 Hz tone: listen
```

The `--play` section records amplifier `status`, speaker mixer values and kernel
messages while the tone plays. Send back `/tmp/audio-report.txt`.

### Bluetooth follow-up from boot c69b55bf (2026-10-24 image)

Established from `build/live-usb/hardware-logs-20261024-1017/c69b55bf…`:
- The firmware fix worked: `QCA Downloading qca/ornbtfw11.tlv` + `ornnv11.bin`,
  `QCA FW build version BTFW.ORNE.1.1.0-00355-PATCH-1_DEF`, `QCA setup on UART is completed`,
  AOSP v1.06. BlueZ shows the controller `3C:EF:A5:29:59:5A`, Powered yes, Discoverable no,
  Pairable no, roles central+peripheral; rfkill is clear; every layer check passed.
- `hci0` is set up twice (3.4 s, then 15.6 s). This is normal for this controller, not
  `devos-bluetooth-recover`: the first setup runs at registration, the kernel powers the
  UART controller down again when nobody holds it open, and bluetoothd's first power-on
  (MGMT 1.23 appears right before the second setup) repeats the setup. Recovery never ran
  (no failed request) and now also ignores failures followed by a completed setup.
- `Failed to set default system config for hci0` is logged by bluetoothd once at start;
  the adapter still came up and powered. Treat as benign unless `btmgmt info` shows
  otherwise.
- `supply vddio1p2 not found, using dummy regulator`: the board describes the radio as an
  M.2 E-key module; no 1.2 V I/O rail is wired in the device tree, and the controller
  answers HCI, loads firmware and enumerates. Nothing in the logs ties it to RF problems,
  so no DT change is proposed.
- The one-time scan result was never captured: the collector's later scan-less run
  overwrote `bluetooth-report.txt` (the scan run at about 1 minute wrote to the same
  file; the last write, with `DEVOS_BT_SCAN=0`, won). There is therefore no evidence yet of what a
  scan does on this hardware.

Changes: the collector now writes scan runs (about 65 s and 185 s after boot) to
`DEVOS-LOGS/<boot-id>/bluetooth-scan-13.txt` and `bluetooth-scan-37.txt`, never overwritten.
Each runs `bluetoothctl --timeout 10 scan on`, `bluetoothctl devices`, `btmon` for the same
window, and `bluetoothctl show` before/after, and prints
`BLUETOOTH-CHECK scan: ok (N distinct device(s) …, M RSSI update(s))` or `FAIL`. The image
adds `bluez5-noinst-tools` (btmgmt; btmon/hcitool/hciconfig are already in `bluez5`).
The shell's scan (`dev-os-devices-linux`) previously listened for only 3 s (enough for
LE advertisements, too short for a classic inquiry) and reported "scan failed" when
another client was already discovering (`InProgress`); it now scans 8 s and joins a
running discovery without stopping it.

Next test on the laptop (needs a new image): put a phone in Bluetooth pairing mode or
a BLE beacon next to the laptop, boot, wait about 4 minutes, then read `bluetooth-scan-13.txt`
and `bluetooth-scan-37.txt` from the ESP `DEVOS-LOGS` folder (or run
`devos-bluetooth-report /tmp/bt.txt` with the phone discoverable). Interpretation:
- `scan: ok`: Bluetooth works; remaining issues are pairing or A2DP.
- `scan: FAIL` with `btmon` showing LE/inquiry commands but no advertising reports: RF path
  (antenna, shared with Wi-Fi: check whether Wi-Fi works and its signal) or the NVM calibration.
- `scan: FAIL` and `btmon` shows command errors: controller/firmware issue; send the files.
Only a result from the laptop decides whether any DT or kernel change follows.

## Wi-Fi hotspot (UX3407NA, `ath12k`)

Evidence from the 2026-10-24 boot `c69b55bf` (`hardware-logs-20261024-1017`): the chip is
reported as `Wi-Fi 7 Hardware name: qcc2072 hw1.0` (PCI `17cb:1112`, driver
`ath12k_wifi7_pci`, firmware `WLAN.COL.1.0.c2-00277`), NetworkManager lists `wlan0`
(`disconnected`) and `p2p-dev-wlan0`, rfkill is unblocked, and the kernel logs
`Timeout while waiting for regulatory update` four times (three times 3 s apart right after Bluetooth
came up, and once more five minutes later): the firmware never answers the regulatory update, so AP on 5/6 GHz
cannot be relied on. The logs do not contain `iw phy` (supported interface modes), `iw reg
get`, NetworkManager or wpa_supplicant journals, or the loaded netfilter modules, so the
cause of a failed start is not proven yet. The image does ship `iw`, `dnsmasq`, `nft`,
`wpa_supplicant` with AP support and NetworkManager with `wifi`; the X2 kernel profile has
`nf_tables`, `nft_masq`, `nf_nat` and `IP_ADVANCED_ROUTER` as modules/built in.

Shell behavior: the hotspot is WPA2 on 2.4 GHz (`band=bg`), IPv4 shared, with a random
12-character password suggested and shown while it runs. A failed start now reports
NetworkManager's device state reason (for example `internet sharing could not start`,
`the Wi-Fi supplicant could not start the access point`), and a Wi-Fi device without AP
mode shows `Hotspot is not supported by this Wi-Fi hardware/firmware` with the driver name.

Diagnostics: `devos-hotspot-report` (source `distro/usb/hotspot-report`; the collector
writes `DEVOS-LOGS/<boot-id>/hotspot-report.txt` every minute) prints
`HOTSPOT-CHECK <layer>: ok|FAIL` for interface and driver, `ap-mode` and
`ap-combination` from `iw phy`, regulatory country and update timeouts, `regulatory.db`,
rfkill, NetworkManager and its `WIFI-PROPERTIES.AP`, wpa_supplicant AP support,
`dnsmasq`, `nft`/`iptables`, the `nf_tables`/`nf_nat`/`nft_masq`/`nft_chain_nat`/`nft_ct`
modules and `ip_forward`. `--try` makes a temporary 2.4 GHz hotspot profile for about 15
seconds, records NetworkManager's exact error and removes the profile; it drops the Wi-Fi
client connection while it runs. The collector only does that when the empty file
`DEVOS-LOGS/HOTSPOT-TRY` exists on the log partition (one attempt, about 2 minutes after
boot, written to `hotspot-try.txt`).

Laptop checklist (after an authorized build that includes these changes):

```sh
devos-hotspot-report --try /tmp/hotspot.txt; sed -n '/Verdict/,/^$/p' /tmp/hotspot.txt
dmesg | grep -i -E 'ath12k|regulatory'
iw phy | sed -n '/Supported interface modes/,/Band/p'; iw reg get
```

Reading it: `ap-mode` FAIL = the driver/firmware cannot host an AP (hardware limit; the
Settings page says so); `ap-mode` ok but `try-hotspot` FAIL with a `dnsmasq`/sharing
error = check `dnsmasq`, `firewall-tool` and the `kernel-nft_*` lines; `try-hotspot` FAIL with a
supplicant/`NL80211` error and `regulatory-update` FAIL = firmware regulatory handshake
(compare `board.bin`/firmware); `try-hotspot: ok` = the radio works and any remaining
failure is in the Settings flow. Not verified: any real access point start.

### Camera: candidate graph found (2026-10-24)

A community A14 camera description exists (see `native/kernel/ux3407na-camera/BOARD-EVIDENCE.md`). It is adapted, with every
value tagged by provenance, into `profiles/asus/ux3407na/kernel/ux3407na-camera-candidate.dtsi` and is **off by default**.
This laptop's DSDT confirms the PM8010 address/bus (0x08 on i2c5, 100 kHz), the three CSIPHYs and the CCI windows; the
sensor reset GPIO, MCLK4, CCI1 bus 1, lanes, PM8010 reset GPIO and LDO mapping are community/A16 claims. The Windows
sensor module cannot supply pins (`tools/live/decode-camx-sensormodule.dev`). The earlier "MCLK3" inference was wrong.

For the camera to appear: build a kernel + modules + DTB from a source prepared with
`native/kernel/ux3407na-camera/prepare-source.dev --output ...`, run
`prepare-board-fixes.dev --enable-camera-candidate`, rebuild the image. A new image with the stock kernel is not enough.
`devos-camera-report` then prints the sensor node's values so the run shows which candidate wiring was booted.

### Bluetooth: controller scans, Settings page showed nothing (boot ed68b0bd, 2026-10-24 14:05)

`bluetooth-scan-13.txt`/`-37.txt` prove the radio works: `SetDiscoveryFilter success`,
`Discovery started`, 12–14 devices in 10 s. Most are nameless LE devices whose BlueZ alias is
the dashed address (`52-5A-26-11-45-E9`); a few are named (`HOCO W56`, `Washer`, `HSJ-LOCK`).
The `0 RSSI update(s)` figure only counts `bluetoothctl` output lines (it does not print RSSI
changes); the UI does not use RSSI, so it is not a fault.

Bug found in the shell helper `bin/dev-os-devices-linux`: its device sort compared names with
the string `<` operator, which the DevLang runtime rejects (`unsupported string operator`).
That code only ran when two listed devices tied on connected/paired, i.e. whenever a real
scan found more than one device, so the Settings page got an error instead of a list.
Fixed (order among equal devices is now discovery order) and reproduced in
`tests/bluetooth-linux.test.py` with the real device lines. Other changes: nameless devices are
labelled `Unknown device · <address>` and listed after named ones; the header shows
`N found, M unnamed`; the Scan button and status show `Scanning…` for the 10 s a scan holds
discovery; a scan that hits `InProgress` joins the running one; the page logs
`Bluetooth UI: scan finished, N device(s) listed, M named` or `… failed: <error>` to the shell log
(`root-session.log` on the ESP). The collector skips its own scan whenever `Discovering: yes`,
and no longer runs `btmgmt find`, so it cannot interfere with a scan the user started.

Pairing from the page calls Device.Pair through the agent; the adapter's `Pairable: no`
only affects incoming pairing and does not block it (not tested on hardware). The panel toggle
only runs `bluetoothctl show`/`power` and does not scan.

Next boot: open Settings → Bluetooth, press Scan nearby, wait 10 s. Expect a list with named
devices first. If it still fails, report what the page shows (spinner stuck, red error text, or
an empty list) and send `root-session.log` — the `Bluetooth UI:` lines say which. Verified offline
only: Python bridge tests and `tsc`; the GTK/gjs tests were not run, and a new image is needed.
