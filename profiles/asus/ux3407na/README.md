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
| `kernel/ux3407na-audio.dtsi` | audio DT patch used by `distro/usb/prepare-board-fixes.dev` |

The kernel config lives in this repository at `linux-kernel`
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

`distro/usb/prepare-suspend-fixes.dev` builds the upstream v4 ASUS EC driver
against the matching kernel build and adds the upstream UX3407NA EC/wakeup
nodes to a private DTB. See `native/kernel/asus-glymur-ec/README.md` for sources.
Use the resulting bundle with `prepare.dev --kernel-bundle`, rather than the
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
from the initramfs; `prepare.dev` now stages the `qca/` entries of `firmware.list` there.
See `docs/live-usb.md` ("UX3407NA Bluetooth cannot scan or pair") and `devos-bluetooth-report`.

## Firmware display fallback (2026-11-02)

Physical boot logs show only simpledrm/Unknown-1, no render node and no
registered MSM display device. The compositor captures a complete desktop,
but the internal panel goes black. The Samsung ATNA33XC20 panel module is
loaded: its probe drives EL_ON3 low and later runtime-suspends the panel.
With the MSM display still deferred, no native display pipeline enables it
again. This is a stronger explanation than desktop startup or rendering;
physical confirmation of the mitigation is still required.

This experimental profile passes
`module_blacklist=panel_samsung_atna33xc20` to preserve the firmware-powered
panel while simpledrm owns scanout. The kernel enforces the blacklist for
both udev and initramfs module loaders. Native panel power management and
its AUX backlight interface are unavailable in this fallback, so brightness
is emulated by display-care's software dim (see boot `686e0fdf` below).
Remove this argument when testing a complete, working native MSM/eDP driver
stack. Other hardware profiles are unaffected.

The follow-up physical boot `b41e97c8` still went black with the panel module
blacklisted. Its logs record `VREG_EDP_3P3: disabling`, while the compositor's
captures contain the desktop. The blacklist leaves the panel's fixed regulator
without an active consumer; `regulator-boot-on` does not prevent unused-regulator
cleanup. Live USB preparation now applies `kernel/firmware-display.dtso` to the
private DTB, adding `regulator-always-on` to that rail whenever this profile's
panel blacklist is enabled. The original kernel bundle is preserved. This is a
targeted firmware-display workaround; physical confirmation is still required.

Follow-up boots `618dd5e6` and `b2ebf257` confirm that the rail stays enabled at
3.3 V, yet the physical screen still goes black while captures show the desktop.
MSM's DisplayPort components still probe repeatedly without registering a native
display. The fallback now blacklists `msm` as well as the panel module, avoiding
partial native display initialization while simpledrm owns the firmware scanout.
In the pinned kernel, `nomodeset` is checked in `msm_drm_init`, after the module
has already registered its display component drivers; blocking the module stops
those probes earlier. This is a candidate mitigation, pending a physical test.

Boot `9ea89654` (2026-11-03) confirms MSM is blacklisted and the eDP rail stays
on, but the physical panel remains black while compositor captures are normal.
`dispcc_glymur` still loads. In the pinned kernel its common probe registers
GDSCs whose initialization rewrites the display power-domain control bits and
enables hardware trigger control. `clk_ignore_unused` only prevents unused-clock
cleanup; it does not suppress this driver probe. The firmware fallback therefore
also blacklists `dispcc_glymur`, leaving firmware display power/clock ownership
untouched. This next mitigation still needs physical verification.

The same boot has no loaded `qrtr` module; Wi-Fi, PMIC GLINK and remoteproc all
fail QMI initialization. `qmi_handle_init` maps an unavailable AF_QIPCRTR socket
family to `-EPROBE_DEFER`. Explicitly load `qrtr` and `qrtr_smd` before unrelated
device probes, and through `modules.load` on installed boots. This removes a
missing protocol-family prerequisite; it does not certify radio/audio operation.

Boot `686e0fdf` (2026-11-03, image `terminal-single-tab-20261103-223625`, logs
`hardware-logs-20261103-boot1`) verifies the whole fallback chain on the physical
panel: with all three modules blacklisted and the eDP rail forced on, the screen
shows the desktop over simpledrm/pixman, and the early `qrtr` load works —
`ath12k` scans (~28 networks) and the audio ADSP boots with the GLYMUR card, a
real PipeWire sink and a DMIC source (one `qcom-apm` GPR timeout remains, the
card still binds). Remaining findings from that boot are session-level, not
kernel: Wi-Fi client association succeeds but the router rejected the password
(`reason=WRONG_KEY`; the Settings error handling for that case is fixed in the
source tree), and with no panel driver there is no `/sys/class/backlight`, so
brightness is emulated by display-care's software dim while this fallback is
active (gated on `module_blacklist=panel...` in the cmdline).
