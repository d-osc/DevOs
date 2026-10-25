# Hardware profiles

The Live USB identifies the machine before it does anything machine specific,
then applies the profile that belongs to exactly that machine and model.
Unknown machines still boot, with the generic profile and a clear message.

```sh
sh profiles/devos-hwprofile identify    # machine identity as JSON, works anywhere, offline
sh profiles/devos-hwprofile select      # which profile layers would be used
sh profiles/devos-hwprofile boot DIR    # identify + select + merge into DIR (what init runs)
```

On a booted Live system the same tool is `/usr/bin/devos-hwprofile`, the merged
result is in `/run/devos-hw/`, and `dev-os-drivers` reports and checks it.

## Layout

```text
profiles/
  devos-hwprofile            POSIX sh: identify, select, merge, apply (runs in the initramfs too)
  generic/                   base layer for every machine
  form-factors/
    laptop/  desktop/  convertible/   (convertible = 2-in-1)
  <vendor>/<model>/          one directory per supported machine, e.g. asus/ux3407na
    match                    hardware match rules (required; no match file = never selected)
    profile.conf             key=value settings and metadata, including test_status
    early.modules            modules loaded from the initramfs to reach the Live USB
    modules.load             modules to load at boot (modules-load.d)
    modules.blacklist        modules to blacklist (modprobe.d)
    kernel.args              kernel command line arguments (applied when the image is built)
    firmware.list            firmware expected under /lib/firmware (checked by dev-os-drivers)
    quirks.list              named quirks
    files/                   copied into the root (etc/, usr/lib/{udev,systemd,modprobe.d,...})
    kernel/                  build-time kernel inputs, e.g. device-tree patches (not shipped)
    README.md                what the profile covers and its test status
```

Every file is optional except `match` and `README.md` for model profiles. The
vendor directory name is the normalised vendor (`asus`, `lenovo`, `hp`, `dell`,
...); the model directory is the lowercase model slug.

## Identification

`identify` reads, without failing on anything missing: DMI/SMBIOS
(`sys_vendor`, `product_name`, `product_family`, `board_*`, `bios_*`,
`chassis_type`), the device tree (`model`, `compatible`, `chassis-type`),
`/proc/cpuinfo`, input devices (tablet-mode switch) and power supplies
(battery). Placeholder strings such as "To Be Filled By O.E.M." are ignored. The
output is JSON with a normalised `machine_id` (`vendor/model`) and `form_factor`:

| Form factor | Decided by (first match wins) |
| --- | --- |
| `2-in-1` | DMI chassis 30/31/32; device-tree `chassis-type` convertible/tablet/detachable; a notebook chassis plus a tablet-mode switch |
| `laptop` | DMI chassis 8/9/10/14; device-tree `laptop`; a battery when nothing else is known |
| `desktop` | DMI chassis 3-7, 13, 15-17, 23-25, 34-36; device-tree `desktop`/`server` |
| `unknown` | none of the above |

`identity.json` also has `warnings` (`no-dmi-sysfs`, `no-devicetree`, ...) and a
`read` string with the raw values that were read. When no model rule matches, the
boot log gets `DEVOS HW: no model rule matched; values read: ...` and
`/run/devos-hw/selection.json` carries the same `read` string. `boot` fails
(instead of leaving empty files) if the identity output is empty.

The tool must run in the Live initramfs BusyBox, which has no `printf` (a small
shim is used), no `command` builtin, no `echo -n`, no `$(( ))`, and in older builds
no `tr`/`uname`. The first physical boot returned an empty identity because of the
missing `printf`; `tests/hardware.test.py` now runs the tool with only that
BusyBox's applets on `PATH` and with values captured from that boot.

`form_factor_source` records which rule decided. A BusyBox without `tr` cannot split
the NUL separated device-tree `compatible` list; the entries are then joined and
`warnings` contains `dt-compatible-unsplit` (the `*...*` match rules still work).

## Matching and merging

1. Model: every `<vendor>/<model>/match` is evaluated. Each line is one rule;
   predicates on a line (`key=glob`) are ANDed and lines are ORed. The matching
   rule with the most predicates wins, so put specific rules on one line.
   Keys: `vendor`, `model`, `machine_id`, `sys_vendor`, `product_name`,
   `product_family`, `product_version`, `board_vendor`, `board_name`,
   `bios_vendor`, `bios_version`, `chassis_type`, `form_factor`, `arch`,
   `dt_model`, `dt_compatible`, `dt_soc`, `cpu_model`, `tablet_switch`, `battery`.
   Values are compared lowercase; DMI/device-tree text is turned into a slug
   (`Zenbook A14` becomes `zenbook-a14`), so write globs in slug form.
2. Form factor: `laptop`, `desktop` or `convertible` (skipped for `unknown`,
   unless the matched model's `profile.conf` declares a `form_factor`).
3. `generic` always applies.

Layers merge in the order generic, form factor, model; later layers win.
`profile.conf` keys override per key. List files concatenate without duplicates,
and a `-name` line removes an inherited entry (the UX3407NA profile uses this to
put the USB host regulator modules ahead of the generic xHCI modules). `files/`
trees overlay by relative path. The kernel command line option `devos.hw=generic`
(or `devos.hw=<vendor>/<model>`) overrides matching.

## What happens at boot

`distro/usb/init` runs `/live/devos-hwprofile boot /run/devos-hw` right after
mounting `/sys`, logs the result (`DEVOS HW: ...`, also saved with the USB boot
logs), loads the profile's `early.modules` to bring up the USB host, and after
creating the RAM overlay runs `apply /newroot`: profile `files/` (only below
`etc/`, `usr/lib/{udev,modprobe.d,modules-load.d,systemd}` and a few audio/devos
paths; symlinks are refused), a generated `modprobe.d` blacklist and
`modules-load.d` list. The tool and profile tree are copied to
`/usr/bin/devos-hwprofile` and `/usr/share/devos/profiles` for diagnostics. If
identification fails the boot continues with built-in defaults. `kernel.args`
and the board DTB are build-time inputs: `distro/usb/prepare.dev` composes the
model's arguments with `devos-hwprofile compose`.

`dev-os-drivers` adds a `hardware_profile` section: selected profile, test
status, quirks and checks (`firmware.list` present or missing, `modules.load`
loaded, blacklisted modules absent). Missing firmware or an unloaded module makes
the audit exit 1. Without a boot selection it reports `not-selected`.

## Adding a machine

1. Boot a Live image on it, or run `sh profiles/devos-hwprofile identify`, and keep the JSON.
2. Create `profiles/<vendor>/<model>/` with `match`, `profile.conf`
   (`name`, `test_status=untested-on-hardware`, `support_level=experimental`) and a `README.md`.
3. Add only what that machine needs: `early.modules`, `firmware.list`, `files/`, `quirks.list`.
4. Add a fixture to `tests/hardware_fixtures.py` and a test in `tests/hardware.test.py`.
5. Raise `test_status` only after observing the behaviour on the hardware.

The same applies to another model of a vendor already present. A new form
factor profile is rarely needed; adjust `form-factors/*` for settings every
machine of that kind shares.

## Support status

| Profile | Status |
| --- | --- |
| `generic`, `form-factors/{laptop,desktop,convertible}` | Baseline defaults. Selection logic is covered by fixture tests; no hardware run. |
| `asus/ux3407na` (Zenbook A14, Snapdragon X2 Elite, ARM64) | **Experimental, untested on hardware.** Identification, matching and merging are tested against synthetic data and the real Live BusyBox. The image boots in QEMU virt, but native boot and device testing (display, USB, Wi-Fi, Bluetooth, audio, touch, suspend) were still pending per `docs/live-usb.md`. |

The match rule values for the UX3407NA come from the device-tree `compatible`
(`asus,zenbook-a14-ux3407na`) the kernel build and DTB check already use; the
DMI product name of the physical machine has not been captured yet. Run
`devos-hwprofile identify` on it and add the real values to the fixtures.

Tests: `python3 tests/hardware.test.py` (identification, matching, merging, apply),
`python3 tests/live-usb.test.py`, `python3 tests/drivers.test.py`. Set
`DEVOS_TEST_SH` to run the shell tool under another shell, for example BusyBox ash.
