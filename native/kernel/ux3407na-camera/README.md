# UX3407NA camera enablement: incomplete

Latest bundle (2026-10-24 follow-up):
`/var/tmp/devos-kernel-x2/bundle-camera-phy-20261024` supersedes the older
`bundle-camera-ready-20261024`. Native boot e11ceb73 reached the new modules but
failed with `csiphy0 not found`: the pinned driver's named-PHY interface did not
match the graph-only DTS. `0002-camss-glymur-phy-resources.patch` and the updated
candidate DTS provide three resources (hardware 0,1,4; dense indexes 0,1,2), named
PHY links and CAMSS PHY4 port index 2. The resulting modules/DTB compile and pass
ABI/checksum checks. This fixes that observed interface mismatch; a successful
physical sensor probe and captured image still need a new native boot.

The current pinned Ubuntu Concept 7.3.0-22.22 source has the OV02C10,
CCI and CAMSS drivers enabled in its configuration, but lacks:

- the `qcom,glymur-camss` driver match;
- Glymur CAMSS/CSI/CCI device-tree nodes;
- the UX3407NA camera sensor, power and endpoint graph;
- PM8010 support in the pinned PM8008 driver (no `pm8010` match).

`0001-camss-glymur.patch` is the unmodified driver patch from Nihal Kumar
Gupta's upstream v4 series. SHA256:
`53402054728a2abefdef809a90f0fa493cf8927152143397b2bfdeab218afd81`.
Source: https://lore.kernel.org/all/20260925-glymur_camss-v4-3-d7c2983d6d7b@oss.qualcomm.com/

Validation: `patch --dry-run --batch --fuzz=0 -p1` against the cached pinned
source passes with a 29-line offset and no fuzz. No cached kernel source was
modified, kernel/module/DTB compiled, or image/USB updated. This patch alone
does not enable a camera and is deliberately not auto-applied to the general
kernel recipe: other profiles use different source versions.

## Prepared dependency stack

`series.json` pins 11 ordered patches and the exact original source file hashes:
the CAMSS match, seven upstream PM8010 patches, and three upstream Glymur
CAMSS/CSIPHY/CCI/MCLK patches. `soc-camera-2.patch` changes only the trailing
hunk context to match this pinned kernel's UART pinctrl block; added definitions
are unchanged. Its upstream original is retained separately for comparison.
The stack was applied successfully with `--fuzz=0` to temporary copies.

Check without building or modifying the original source:

```sh
d native/kernel/ux3407na-camera/prepare-source.dev -- \
  --source /var/tmp/devos-live-build/linux-qcom-x1e-7.3.0
```

Adding `--output /path/to/new-private-source` prepares a complete private source
copy for later work. It does not compile or enable an unverified board graph.
The helper rejects mismatched source/patch hashes and existing output paths.

Next requirements are verified UX3407NA sensor power/GPIO/CSI mapping, matching rebuilt kernel/modules
and DTB, plus native `cam -l`, real preview and JPEG capture tests. Neither an
A16 device tree nor Windows camera binaries establish the A14 power wiring.
Collect the current machine's evidence with:

```sh
sh tools/live/collect-native-readiness.sh /tmp/devos-camera-report
```

The image's new `libcamera-gst` is necessary userspace support, not a substitute
for the missing kernel graph. Camera support is still incomplete; this work
must not be reported as a working-camera test.

Board facts derived from this laptop's ACPI tables and the open wiring items: see `BOARD-EVIDENCE.md`.

## Matching module bundle (2026-10-24)

`prepare-bundle.dev` compiles the three changed modules against the existing checked
kernel build, checks every imported symbol CRC against its Module.symvers, requires
the base EC proof's symbol-table hash and the same kernel config, then composes the
candidate DTB with EC/audio fixes. The main kernel Image is unchanged: these changes
are all in loadable modules and DT. A DTB alone is rejected by USB staging.

```sh
d native/kernel/ux3407na-camera/prepare-bundle.dev -- \
  --source /var/tmp/devos-camera-source-20261024 \
  --build /var/tmp/devos-kernel-x2/build-latest-20261023 \
  --bundle /var/tmp/devos-kernel-x2/bundle-audio-ec-20261024-110258 \
  --output /var/tmp/devos-kernel-x2/bundle-camera-ready-20261024
```

This bundle was compiled and checked in this workspace. Its board graph is still
the community candidate documented in BOARD-EVIDENCE.md; successful compilation
does not establish sensor power wiring or a working image. No USB was flashed.
Use `live-usb.ps1 prepare -KernelBundle` with this exact bundle in a fresh staging
directory for the next experimental image, then check `devos-camera-report`,
`cam -l`, a live preview and a captured JPEG on the laptop.
