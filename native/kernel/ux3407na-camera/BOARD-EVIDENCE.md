# UX3407NA camera: what the evidence establishes (2026-10-24)

Sources: this laptop's own Windows ACPI DSDT (`HKLM\HARDWARE\ACPI\DSDT`, exported with
`tools/live/export-windows-camera-evidence.ps1`, decompiled with `iasl`), the Windows
driver store camera packages, the pinned Ubuntu Concept 7.3.0-22.22 source, the
built bundle `bundle-audio-ec-latest-20261023-2255`, and the upstream A14 DTS.

## Established (derived from evidence)

| Fact | Evidence |
| --- | --- |
| Camera is MIPI (Qualcomm Spectra), not USB | ACPI `CAMP/CAMF/CAMI/MPCS/FLSH` devices; no USB camera in `lsusb` of the physical boot |
| Front sensor is an OV02C10 (`ovti,ov02c10`), module `luxvision_ov02c10`, EEPROM `m24c64x` | `com.qti.sensormodule.ov02c10.bin` strings |
| Sensor I2C address 0x36 (7-bit) | `qsh_camera_ov02c10_2.json` slave 54, "right-shifted by 1" |
| Camera platform device owns CAMSS-family regs 0x0ac13000, 0x0ac19000 (0xc000), 0x0ac15000, 0x0ac16000 | ACPI `CAMP._CRS`; 0xac15000/0xac16000 equal `cci0`/`cci1` in `soc-camera-2.patch` |
| GPIO99 (MCLK3 pin, shared pull-up) is listed by ACPI `CAMP`, but the front sensor does **not** use MCLK3 per the community A14 DT (MCLK4, gpio100). My earlier MCLK3 inference was wrong. | ACPI `CAMP._CRS`; community `a14-camera.dtsi` |
| GPIO111 is the camera privacy/indicator LED | ACPI `CAMP._CRS` exclusive GPIO 0x6F; upstream UX3407NA DTS `cam_indicator_en` = gpio111 |
| Camera clock controller is already in the DTB and the module is built | `camcc@ade0000` in the bundle `board.dtb`; `camcc-glymur.ko` in modules |
| Kernel config already enables the whole stack | `CONFIG_VIDEO_QCOM_CAMSS=m`, `I2C_QCOM_CCI=m`, `VIDEO_OV02C10=m`, `MFD/REGULATOR_QCOM_PM8008=m`, `CLK_GLYMUR_CAMCC=m`, `PHY_QCOM_MIPI_CSI2=m` in `snapdragon-x2.config`. No config fragment is needed; the missing pieces are driver matches and DT. |
| Built modules lack Glymur support | `modinfo qcom-camss.ko`: only `qcom,x1e80100-camss`; `qcom-pm8008.ko`: only `qcom,pm8008` (no `qcom,pm8010`) |
| Pinned DT has no CAMSS/CSIPHY/CCI nodes | `glymur.dtsi` has `camcc` only; the 11-patch stack in this directory adds them (dry-run applies with `--fuzz=0`) |

## Missing (not derivable offline, so not written into any DTS)

- Which CCI controller and bus (`cci0_i2c0` ... `cci1_i2c1`) carries the sensor.
- Sensor reset GPIO and its polarity, any power-enable GPIO.
- Regulators: PM8010 camera PMIC rails/LDOs for the sensor (avdd/dvdd/dovdd) and the
  CSIPHY supplies (`vdda-0p9`, `vdda-1p2`) from the A14 power tree.
- Which CSIPHY and the CSI data lanes / polarity for the front sensor.
- The ACPI tables contain none of this; Windows keeps it in the Qualcomm sensor
  module binary and the platform-engine driver. `com.qti.sensormodule.ov02c10.bin`
  holds the power sequence but uses an undocumented tagged format that was not decoded.

Obtaining them: the A14 camera DT from the Qualcomm/linux-msm authors (the A16 sibling
was posted tested on hardware), or a decode of the sensor module binary's power-setting
and module-configuration tables, or schematic data. Do not copy the A16 values.

## Next step once the values exist

1. `d prepare-source.dev -- --source <pinned> --output <new private copy>`.
2. Fill `profiles/asus/ux3407na/kernel/ux3407na-camera.dtsi` (it refuses to compile
   until its `#error` is removed) and append it with the audio fragment.
3. Rebuild kernel + modules + DTB (not done here), then run `devos-camera-report`.

## Update 2026-10-24 (later): real sources found; candidate graph written

**Decoder result.** `tools/live/decode-camx-sensormodule.dev` on `com.qti.sensormodule.ov02c10.bin` (220798 bytes) confirms
sensor/module identity only: names `sensorDriverData` 0xd0, `cameraModuleData` 0x108, `powerSetting` 0x258,
`luxvision_ov02c10` 0x35cbc, `m24c64x_ov02c10_eeprom` 0x35c9d, a 19.2 MHz value at 0x2bb16, slave byte 0x6c (7-bit 0x36).
The file holds sensor register tables and logical power-step types, **not** GPIO numbers, rails, CSI lanes or the CCI bus
(searched the u32 values 239/106/235/236/100: only register-table coincidences). So it cannot supply the wiring.

**Own-DSDT confirmations.** `PML0` (`QCOM0FC6`): I2C address 0x08, 100 kHz (0x186A0) on `\_SB.I2C6`, whose base is
0x00B94000 = `i2c5` in `glymur.dtsi`. `MPCS` lists exactly csiphy0 (0xace4000), csiphy1 (0xace6000), csiphy4 (0xacec000),
matching the SoC patches. `CAMP` has CCI0/CCI1 windows, GPIO99 and GPIO111. GPIO 239 and 106 do not appear in any camera
device (the `0xEF`/`0x6A` hits are PMIC GPIO interrupts on `PM01`/`BCL1`).

**Upstream status** (all still on mailing lists, none merged as of the searches): Glymur CAMSS v2 (6 patches, linux-media,
Sep 2026), "Add CCI and CAMSS support for Glymur" DTS series (CRD, OV08X40 on CSIPHY4), PM8010 as `qcom,pm8010-i2c`
(v2). Our 11 patches use `qcom,pm8010-i2c` and the same CSIPHY/CCI layout, consistent with those. Community A14 work:
[chrispouliot/linux-zenbook-a14-arm](https://github.com/chrispouliot/linux-zenbook-a14-arm) (`patches/camera` 15 commits,
`patches/a14-camera.dtsi`; "working with patches", libcamera software ISP, privacy LED lights) and
[zeroknots/asus-a14-x2elite-kernel](https://github.com/zeroknots/asus-a14-x2elite-kernel) (camera wiring for OV02C10 and an
HM1092 IR sensor, experimental). Their A14 values are third-party claims; Dev OS has not reproduced them.

**Candidate (not verified here)** in `profiles/asus/ux3407na/kernel/ux3407na-camera-candidate.dtsi`; every line is tagged
[ACPI] / [SOC] / [COMM] (community claim) / [A16]:

| Value | DT property | Source |
| --- | --- | --- |
| PM8010 at 0x08, 100 kHz, i2c5 | `&i2c5 pmic@8` | [ACPI] confirmed |
| PM8010 reset GPIO 106 | `reset-gpios` | [A16], not in ACPI |
| LDO3 2.8 V, LDO4 1.8 V, LDO7 2.8 V; avdd=L7, dovdd/dvdd=L4 | `regulators`, `*-supply` | [A16], not verified; PM8010 input supplies (`vdd-l3-l4`, `vdd-l7`) not set by the source |
| Sensor on CCI1 bus 1 (gpio235/236) at 0x36 | `&cci1_i2c1 camera@36` | [COMM]; 0x36 from Windows config |
| Sensor reset GPIO 239 | `reset-gpios` | [COMM] |
| MCLK4 (gpio100), 19.2 MHz | `clocks`, `assigned-clock-rates` | [COMM]; 19.2 MHz also in the Windows module |
| CSIPHY4, lanes `<1 2>`, 400 MHz link | `&csiphy4_in_ep`, `link-frequencies` | [COMM] |
| CSIPHY4 rails vreg_l1f_e1 / vreg_l4f_e1 | `vdda-0p9/1p2-supply` | [A16]; rails exist in the pinned A14 DTS |

`dtc` compiles the pinned A14 DTS + the SoC patches + this candidate (checked in WSL). Enabling is explicit:
`prepare-board-fixes.dev ... --enable-camera-candidate` (needs a source prepared with `prepare-source.dev --output`, records the
candidate hash in `board-fixes.json`). Because the driver patches are required too, the matching kernel/modules must be rebuilt
from that same source; a DTB alone, or the stock kernel (no `qcom,glymur-camss` or PM8010 alias), shows nothing.
Remaining risk: the unverified values could mis-power the sensor or PMIC (wrong GPIO or rail); try on the laptop only
after the user accepts that.
