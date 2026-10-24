# ASUS Zenbook A14 UX3407NA (Snapdragon X2 Elite, ARM64)

Profile id `asus/ux3407na`. Matches the device-tree compatible
`asus,zenbook-a14-ux3407na`, or DMI vendor ASUS with a product/board name
containing `UX3407NA`.

| File | Purpose |
| --- | --- |
| `match` | hardware match rules |
| `profile.conf` | board id, SoC, kernel profile and DTB, audio card, renderer, lid policy |
| `early.modules` | USB host regulator/PHY modules loaded from the initramfs |
| `kernel.args` | extra kernel command line arguments for the UKI |
| `firmware.list` | firmware expected under `/lib/firmware` (checked by `dev-os-drivers`) |
| `quirks.list` | named quirks consumed by tools and docs |
| `files/` | files copied into the Live root (`etc/systemd/logind.conf.d` lid policy) |
| `kernel/ux3407na-audio.dtsi` | audio DT patch used by `distro/usb/prepare-board-fixes.py` |

The kernel config lives in the sibling DevOsLinuxKernel repo
(`config/profiles/snapdragon-x2.config`, `scripts/build-snapdragon-x2.sh`).

## Test status

**Untested on hardware.** The USB image builds and boots in QEMU virt; native
boot, display, USB, Wi-Fi, Bluetooth, audio, touch and suspend/resume were
still pending when this profile was written. The first physical boot logs
(see `docs/live-usb.md`) showed missing Wi-Fi board data and audio topology;
fixes exist but are unverified. Lid suspend is disabled until suspend is tested.
Update `test_status` in `profile.conf` and this section only after observing
the behaviour on the machine.

Speaker diagnosis and the `devos-audio-report` checklist: `docs/live-usb.md`
("UX3407NA speakers not found"). Audio remains untested on this machine.

## Suspend correction (2026-10-23)

The original Live bundle lacked the ASUS EC driver and EC device-tree node.
The user reported that manually selecting Sleep on this laptop resulted in a
black screen that did not wake. This is consistent with missing EC Modern
Standby notifications; the precise hang still requires native suspend logs.

`distro/usb/prepare-suspend-fixes.py` builds the upstream v4 ASUS EC driver
against the matching kernel build and adds the upstream UX3407NA EC/wakeup
nodes to a private DTB. See `native/kernel/asus-glymur-ec/README.md` for sources.
Use the resulting bundle with `prepare.py --kernel-bundle`, rather than the
original bundle. The board's sleep drop-in selects s2idle only. A suspend
service precondition refuses sleep if the EC is unbound or s2idle is absent.
Pre-suspend and post-resume logs are saved on the mounted Live ESP under
`DEVOS-LOGS/<boot-id>/sleep-pre.txt` and `sleep-post.txt`. Lid suspend remains
disabled until physical wake testing passes. QEMU does not emulate this EC.

Camera: MIPI (CAMSS/OV02C10), not USB. The device tree lacks the camera graph, so no
`/dev/video*` appears; see `docs/live-usb.md` ("UX3407NA camera not found") and
`devos-camera-report`. Camera remains unsupported.

Bluetooth: WCN7850-class controller on a serdev UART (`hci0` registers). Earlier
images failed to load `qca/ornbtfw11.tlv`/`ornnv11.bin` because the controller probes
from the initramfs; `prepare.py` now stages the `qca/` entries of `firmware.list` there.
See `docs/live-usb.md` ("UX3407NA Bluetooth cannot scan or pair") and `devos-bluetooth-report`.
