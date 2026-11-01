# Independent DevOs Linux base

For independent ARM64 Live USB staging, see [Live USB](../docs/live-usb.md).
The UX3407NA profile builds an experimental USB candidate; native boot/device testing remains pending. QEMU tools are retained.

This is the independent source-build path. It does **not** extract an Ubuntu,
Debian, Fedora or other distribution root filesystem, use apt in the target,
or rename another distribution's image. Linux needs a userspace in addition to
the kernel; DevOs uses upstream components instead of reimplementing libc,
init, graphics, networking and the JavaScript engine.

There are two distinct artifacts:

| Artifact | Contents | Validation / scope |
| --- | --- | --- |
| `base/output/Image` + `initramfs.cpio.gz` | Linux 7.2.11, static repo `busybox-cli`, dash, `pm-cli` with a static DevLang runtime, and DevOs os-release | ARM64 QEMU boot, init checks and clean poweroff; console only |
| `oe` / `devos-image` | Custom `DISTRO=devos`, linux-kernel rebuilt by OE with matching modules, systemd, GJS, GTK3, Wayland/labwc, VTE, WebKitGTK 4.1, native network/audio/Bluetooth tools and DevOs shell | Build metadata and dependency checks; full desktop compilation and graphical boot are separate checks |

The console base is a recovery/bootstrap proof, **not** a finished desktop,
installer or physical-machine image. Its small QEMU kernel config deliberately
does not represent the ASUS UX3407NA's hardware requirements. The desktop recipe rebuilds the selected linux-kernel source/config with
desktop requirements and matching modules; it does not inject an unmatched
prebuilt kernel into the desktop rootfs. A board-specific machine layer, correct device tree, firmware
and native tests are still required for UX3407NA deployment.

## Repository userland

Both image paths use `busybox-cli` and `pm-cli` from this repository. The
`linux-kernel` initramfs and Live USB scripts use `tools/build/userland.sh`;
OpenEmbedded snapshots the same native binary and selects `devos-busybox`
as the base-utils provider. The existing `devos-pm` recipe installs the
current `pm-cli` sources and records their repository path in provenance.
There is no BusyBox source tarball or Rust DevOsPM checkout in these paths.

`busybox-cli` is built as a static native executable. Its `sh`/`ash` entry points
exec a separately built static dash at `/usr/libexec/devos/dash`. Tiny images
include static target-built `d` and `devrun` to run `pm-cli`; desktop images
use the `devlang` package. The first PID-1 shell initializes procfs, required
by the native compiler's command-line access. Dash, musl and runtime sources
are pinned by SHA-256 in `tools/build/userland.sh`.

For a staged userland check without compiling a kernel or desktop:

```sh
bash tools/build/userland.sh all /var/tmp/devos-userland-root aarch64
python3 tests/lib/check-userland.py /var/tmp/devos-userland-root
sudo unshare -mn python3 tests/lib/check-userland.py /var/tmp/devos-userland-root --root
python3 tests/lib/check-userland-qemu.py /var/tmp/devos-userland-root /path/to/ARM64/Image
```

A complete host DevLang installation, a static-capable target C compiler, Python 3,
and Rust/rustup are required for the tiny-image runtime build. An existing static
target bundle can be selected with `DEVOS_DEVLANG_BUNDLE` (include its LICENSE).
`DEVOS_USERLAND_WORK` sets the cache; `DEVOS_USERLAND_CC` and `DEVOS_MUSL_CC`
select C compilers. `DEVOS_BUSYBOX_SOURCE` and `DEV_OS_PM_SOURCE` retain explicit
source overrides. Only the staged userland was boot-tested for this migration;
this does not establish a newly built desktop image or hardware certification.

## DevOs Linux Kernel source

Both distro paths now select the repository's `linux-kernel` project by default
(`C:/Users/ondev/Projects/DevOs/linux-kernel` in this workspace). Its current
selected kernel is `7.2.11-devos`, ARM64. No files in that project are changed.

The console base uses its exact built ARM64 Image and matching saved config.
The desktop uses the `linux-devos` kernel provider: it snapshots the Linux source
archive used by that project and its actual ARM64 config, merges the desktop
fragment, and rebuilds the Image and all configured modules together. Systemd,
GTK, labwc and the DevOs desktop userspace remain part of the existing image.

Build the selected project's ARM64 kernel first. The integration reads its
`scripts/common.sh`, `config/kernel-fragment.config` and
`output/kernel-<version>-aarch64.config` / `output/devos-Image-<version>-aarch64`.
The source archive is read from `~/devos/downloads/linux-<version>.tar.xz`.
Use `DEVOS_KERNEL_WORK` for a different workspace or `DEVOS_KERNEL_ARCHIVE`
for an explicit archive. Version, ARM64 Image magic and DevOs release banner are
validated before preparation. Archive, Image and config hashes, project path,
and Git revision are recorded in `devos-kernel.json` and build provenance.

To select another checkout from Windows:

```powershell
.\distro.ps1 desktop-check -KernelProject 'C:\Users\ondev\Projects\DevOs\linux-kernel'
```

On Linux, export `DEVOS_KERNEL_PROJECT=/path/to/linux-kernel` before the
commands below. The desktop target remains `qemuarm64`; cross-architecture
and physical-device support are separate integration work.

## Build from Windows

For running built artifacts in QEMU, see [QEMU runner](../docs/qemu.md):
`./qemu.ps1 base -Test` runs the console smoke test and `./qemu.ps1 desktop`
opens the graphical VM after a complete desktop image build.

```powershell
.\distro.ps1 base
.\distro.ps1 base-test
.\distro.ps1 desktop-prepare
.\distro.ps1 desktop-check
.\distro.ps1 desktop-kernel-check
.\distro.ps1 desktop-build
```

The default WSL **build host** is named Ubuntu. It only runs compilers and QEMU;
it is not the target OS. `-BuildDistribution NAME` selects another suitable WSL
Linux host. The compiler may identify its Ubuntu vendor in a kernel build log;
that is build-tool provenance, not an Ubuntu kernel source or userspace.

Artifacts from `base` and `base-test` are copied to `build/devos-base/` on Windows.
No command here formats a drive, writes a USB device, changes Windows boot order,
or installs DevOs over the host OS.

## Build directly on Linux

ARM64 native bootstrap build (no root required):

```sh
bash distro/base/build.sh
bash distro/base/test-qemu.sh
```

Tools: gcc, binutils, make, flex, bison, bc, curl, tar with xz/bzip2 support,
sha256sum, gzip, Python 3, rsync, kernel host headers/libelf development tools,
and `qemu-system-aarch64` for the test. `DEVOS_BASE_WORK` defaults to
`/var/tmp/devos-base`; `DEVOS_BASE_JOBS` defaults to 4. Build paths must not have
whitespace. Runtime, musl and dash source URLs/checksums are pinned in
`tools/build/userland.sh`; kernel provenance is recorded in `output/kernel-source.json`. The build retains source archives and complete sources in
the work directory; retain and redistribute corresponding source and licenses
as required when distributing binaries. The base embeds no downloaded firmware.

To open its local console, use:

```sh
qemu-system-aarch64 -machine virt -cpu cortex-a72 -m 512 -nographic \
  -kernel /var/tmp/devos-base/output/Image \
  -initrd /var/tmp/devos-base/output/initramfs.cpio.gz \
  -append 'console=ttyAMA0 rdinit=/init'
```

The test first verifies artifact hashes and inspects the packed initramfs,
including the static ARM64 BusyBox executable, console node, PID 1, applet
links and absence of shared host libraries. The smoke variant adds
`devos.smoke=1` and checks `DEVOS_BASE_SMOKE_PASS`, absence
of kernel panic, kernel version and poweroff in `output/qemu-boot.log`.

## Desktop source build

OpenEmbedded/BitBake is a build system, not the distribution being installed.
The `meta-devos` layer defines DevOs itself. Its companion layers are pinned to
compatible Yocto 6.0 (`wrynose`) commits in `oe/sources.lock`. No Poky distro,
Ubuntu package repository, casper, GDM or prebuilt WSL compositor is used.

The desktop image carries no VS Code, Chrome, Rust, Node.js/nvm or QEMU; see
[bundled apps](../docs/bundled-apps.md) for what is (and is not) in it.

```sh
npm ci
npm run build
bash distro/oe/build.sh --prepare
bash distro/oe/build.sh --parse
bash distro/oe/build.sh --kernel-check
bash distro/oe/build.sh --build
```

Use a supported OpenEmbedded Linux build host with its documented host tools,
including chrpath, diffstat, a working `en_US.UTF-8` locale and network access.
The build must run as a normal user on the Linux filesystem, not `/mnt/c`.
`DEVOS_OE_WORK` defaults to `/var/tmp/devos-oe`. Full source builds are large
and can take hours; the default limits parallel jobs to 2 for this machine.
For a private locale without changing the host system:

```sh
mkdir -p /var/tmp/devos-oe/locale
localedef --no-archive -i en_US -f UTF-8 /var/tmp/devos-oe/locale/en_US.UTF-8
export LOCPATH=/var/tmp/devos-oe/locale
```

Preparation snapshots the built architecture-independent desktop bundles and
native tracker **source**; the tracker is cross-compiled by the target recipe.
It records the payload hash and desktop build information in
`payload/provenance.json`. Existing modified layer checkouts are never reset.
Generated `build/conf` and copied `meta-devos` files are managed by preparation.

`--parse` checks recipes and resolves the image task graph with `bitbake -g`;
it does not prove that every component compiles or the graphical session boots.
`--kernel-check` runs the actual `linux-devos` dependency chain through
`do_configure`, including archive unpacking, shared-source setup, config merging
and Linux Kconfig. Use `desktop-kernel-check` from PowerShell for the same check;
it reuses cached build dependencies and does not compile the full desktop image.
Image outputs after a successful complete build are in
`build/tmp/deploy/images/qemuarm64/`. `runqemu qemuarm64 devos-image slirp` from
the sourced OE environment can test that image. Rootfs package manifests and
build history should accompany the image when reviewing its provenance.

The QEMU development image uses a graphical greetd/PAM login. Initial setup
creates the first administrator; additional personal users and GitHub bindings
are managed in Settings → Accounts. Each personal user gets a separate UID and
private home. A dedicated public `devos` Guest account remains available.
See [accounts](../docs/accounts.md) for provisioning and validation limits.
It has no SSH server or disk installer. Firmware, package update policy,
physical boot media and the full hardware acceptance suite remain additional
distribution engineering work.

The application currently has no declared redistribution license, so its local
OE recipes use `LICENSE = "CLOSED"`; upstream component licenses remain intact.
Do not infer that this grants permission to redistribute the whole image.

The older `tools/live/` workflow remains an Ubuntu-based experiment and is **not**
the independent DevOs build path. Its existing ISO cannot be made independent
by changing branding or swapping only its kernel.

References: [Linux kernel](https://www.kernel.org/),
[musl](https://musl.libc.org/), [BusyBox](https://busybox.net/),
[OpenEmbedded](https://www.openembedded.org/),
[Yocto build documentation](https://docs.yoctoproject.org/6.0/).
