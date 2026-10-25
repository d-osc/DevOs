# DevOs Live for ASUS UX3407NA

**Legacy Ubuntu-based experiment.** For the independent upstream Linux/source
build path requested for DevOs, use [distro/](../../distro/README.md) and
`distro.ps1`. The scripts below do not produce an independent DevOs userspace.

Experimental ARM64 live image for this specific Snapdragon X2 machine. DevOs
0.3.6 runs as the native Wayland session on an Ubuntu Concept 26.10 userspace.
The custom kernel is compiled from Ubuntu's Qualcomm source, not the WSL kernel.

## Pinned inputs

- ISO: `stonking-desktop-arm64+x1e-20260929.iso`
- ISO origin: https://people.canonical.com/~platform/images/ubuntu-concept/
- ISO SHA256: `0c4888195c693977ad65c74f5b516d1ce69b5e56e8aacfc7f4eacf3af18b145b`
- Kernel: `linux-qcom-x1e_7.3.0-22.22.tar.gz`
- Kernel origin: https://ppa.launchpadcontent.net/ubuntu-concept/x1e/ubuntu/pool/main/l/linux-qcom-x1e/
- Source SHA512: `c3cd51e563a3373ba029e7093c65a4a9951017b89f2b00417728fea54bfa0f5e18e521c69cc1543ac87860e00a658a2da5bcee3d8f92f4e3ba5de41ee50f8690`
- Kernel starting config: `/boot/config-7.3.0-15-qcom-x1e` from the base ISO.

The source Makefile identifies 7.3.0-rc6. The custom local version is
`-devos-x2`; retain the actual `kernelrelease.txt`, rather than deriving a
kernel version from Ubuntu's package ABI number.

## Build order

Run the shell scripts as root in an ARM64 Linux build environment. They only
stage files in `DEVOS_LIVE_WORK`; none writes a physical disk. The defaults
refer to the original development machine. Set these variables for other paths:

```sh
export DEVOS_LIVE_WORK=/var/tmp/devos-live-build
export DEVOS_SOURCE_ROOT=/path/to/DevOs
export DEVOS_BASE_ISO=/path/to/stonking-desktop-arm64+x1e-20260929.iso
export DEVOS_KERNEL_JOBS=12
```

1. Verify the pinned ISO and source checksums. Extract the ISO with xorriso into
   `$DEVOS_LIVE_WORK/iso`, and the kernel tarball into `$DEVOS_LIVE_WORK`.
2. Run `prepare-devos-rootfs.sh` to merge the base, standard and live layers,
   applying overlay whiteouts. It refuses to overwrite an existing rootfs.
3. Run `configure-devos-live-rootfs.sh` to install native runtime dependencies.
   It binds `/dev`, `/proc`, `/sys` into the staging chroot and blocks package
   service startup with policy-rc.d. Finish or unmount those staging mounts
   before deleting any build directory.
4. Build the DevOs application and the patched labwc 0.7.1 compositor using
   the repository's existing build/setup tools, then `stage-devos-desktop.sh`.
5. Run `build-devos-kernel.sh`, then `test-devos-kernel-qemu.sh`.
6. Run `finish-devos-live.sh` to create initrds, an unsigned ARM64 EFI kernel
   containing the exact UX3407NA DTB, the live squashfs and the bootable ISO.
7. Run `validate-devos-initrds.dev` to check UUIDs and the packed `ORDER` files.
   Merely copying a new hook into an existing initrd is insufficient; it must
   also be included in its execution order. Fresh mkinitramfs builds generate
   that order automatically when `90devos-session` is staged before the build.

Save the final package manifest and source archives together with the image;
apt packages can change after this snapshot.

The build requires standard kernel build tools (gcc, make, flex, bison, bc,
libelf-dev, libssl-dev), rsync, squashfs-tools, xorriso, systemd-ukify,
systemd-boot-efi and qemu-system-aarch64 for the kernel smoke test.

## Runtime behavior and limits

- Default boot: DevOs, user `devos`, temporary live root, pixman safe graphics.
- Alternative entries: automatic renderer; original Ubuntu Qualcomm kernel
  with the same DevOs userspace.
- Network pages use NetworkManager on native Linux, retaining Windows interop
  only when the shell runs under WSL. New passwords and profiles are configured
  through native Linux settings. No Windows WLAN profiles are imported.
- Kernel TUN/WireGuard, Qualcomm Wi-Fi/BT, DRM/input and live filesystem support
  are enabled; this does not certify the corresponding hardware features.
- OEM Wi-Fi calibration, laptop DSP firmware, sound and suspend still require
  native testing. The image contains publicly packaged firmware, with no OEM
  firmware copied from Windows. Lid-triggered suspend is disabled for testing.
- The kernel is unsigned. Secure Boot must permit it; no firmware settings or
  boot order are changed by these scripts.
- The live hook removes GDM's Ubuntu installer seeding wait. It does not disable
  Snap confinement or AppArmor. The final image boots straight into DevOs.
- QEMU tests CPU/kernel boot on a virtual ARM64 machine. Headless compositor
  tests cover desktop behavior. Neither replaces booting the actual UX3407NA.
- This is a live test image, not a supported permanent-install distribution.

Use `devos-hardware-report NEW_OUTPUT_DIRECTORY` from the live terminal to
collect hardware logs. That collector refuses WSL and non-matching hardware.
