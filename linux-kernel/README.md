# DevOs — a tiny Linux built from the latest mainline kernel

**DevOs** is a minimal, from-scratch Linux operating system:

| Component      | Version                                        |
|----------------|------------------------------------------------|
| Linux kernel   | **7.2.11** (latest stable at build time) — `7.2.11-devos` |
| Userland       | **busybox-cli** from `../busybox-cli` (native, statically linked) + dash         |
| Package manager| **pm-cli** from `../pm-cli` — DevLang sources plus static target-built `d`/`devrun` |
| Developer tools| **git 2.56.0** (static musl, HTTPS via openssl+curl) · **gh 2.102.0** (GitHub CLI) |
| Architecture   | `aarch64` **or** `x86_64` — auto-detected from the build host at every step (kernel image type, musl target, QEMU machine, gh asset, serial console) |
| Root filesystem| initramfs (everything runs from RAM)          |
| Init           | BusyBox `init` + `/etc/inittab` + `rcS`        |

Boots to a root shell in ~1–2 seconds under QEMU, with networking
(virtio-net + DHCP), devtmpfs, mdev, its own package manager, and a proper
`poweroff`.

---

## Repository layout

```
DevOs/linux-kernel/
├── build.sh                    # one-shot full build (run inside WSL/Linux)
├── scripts/
│   ├── common.sh               # versions, paths, helpers
│   ├── 00-check-env.sh         # verify toolchain + internet
│   ├── 10-build-kernel.sh      # download/config/build Linux 7.2.11
│   ├── 20-build-busybox.sh     # build repo busybox-cli + static dash
│   ├── 25-build-devospm.sh     # stage pm-cli + static DevLang runtime
│   ├── 26-build-git-gh.sh      # static git (openssl+curl, musl) + gh binary
│   ├── 30-build-rootfs.sh      # assemble + pack the initramfs
│   ├── 40-mkiso.sh             # bootable arm64 EFI ISO (optional)
│   └── run-qemu.sh             # boot DevOs (--test = automated boot test)
├── config/
│   └── kernel-fragment.config  # DevOs kernel config, merged onto defconfig
├── rootfs-overlay/             # files copied verbatim into the rootfs
│   ├── init                    # PID 1: mounts proc/sys/dev, execs /sbin/init
│   └── etc/                    # inittab, rcS, motd, os-release, profile, ...
└── output/                     # build artifacts (git-ignored)
```

## Requirements

A Linux environment (native or WSL2) with: `gcc make flex bison bc perl cpio
gzip xz bzip2 curl tar qemu-system-aarch64`. On the WSL2 Ubuntu used for
development the build also needs a complete host DevLang installation, Python 3,
Rust/rustup and the target musl standard library for building the static DevLang
runtime used by `pm-cli`. Rust builds the language runtime, not the package manager.
The runtime, dash and musl source dependencies are checksum-pinned in
`../tools/build/userland.sh`; no target executable or library is copied from the host.
Set `DEVOS_USERLAND_CC` for a target C compiler, `DEVOS_MUSL_CC` for an existing
musl compiler, or `DEVOS_DEVLANG_BUNDLE` for a static target `d`/`devrun` bundle
with its LICENSE. `DEVOS_BUSYBOX_SOURCE` and `DEV_OS_PM_SOURCE` explicitly override
the default projects in this repository. Build caches use `DEVOS_USERLAND_WORK`
(default `~/.cache/devos-userland`).

Optional, for the ISO: `sudo apt install grub-efi-arm64-bin grub-common mtools xorriso`

## Build

From Windows (WSL2 Ubuntu):

```bash
wsl -d Ubuntu -- bash /mnt/c/Users/ondev/Projects/DevOs/linux-kernel/scripts/build.sh
```

Or from any Linux shell:

```bash
./scripts/build.sh
```

Each step is idempotent — re-running skips downloads and configured trees.
Artifacts land in `output/`:

| File                                  | What it is                          |
|---------------------------------------|-------------------------------------|
| `devos-Image-7.2.11`                  | arm64 kernel image                  |
| `devos-initramfs-7.2.11.cpio.gz`      | DevOs rootfs (BusyBox + overlay)    |
| `devos-1.0.0.iso`                     | bootable arm64 EFI ISO (optional)   |
| `kernel-7.2.11-<arch>.config` | saved kernel config; userland provenance is embedded in the rootfs         |
| `SHA256SUMS`, `boot-test.log`         | checksums / boot test evidence      |

Build workspace (sources) lives at `~/devos` inside WSL — override with
`DEVOS_WORK=...`.

## Run

Interactive boot (exit QEMU with `Ctrl-A` then `X`):

```bash
wsl -d Ubuntu -- bash /mnt/c/Users/ondev/Projects/DevOs/linux-kernel/scripts/run-qemu.sh
```

Automated boot test (boots, checks `uname -r` / os-release, powers off):

```bash
wsl -d Ubuntu -- bash /mnt/c/Users/ondev/Projects/DevOs/linux-kernel/scripts/run-qemu.sh --test
```

Manual QEMU invocation:

```bash
qemu-system-aarch64 -M virt -cpu cortex-a57 -smp 2 -m 1G -nographic \
  -kernel output/devos-Image-7.2.11 \
  -initrd output/devos-initramfs-7.2.11.cpio.gz \
  -append "console=ttyAMA0" \
  -device virtio-net-pci,netdev=n0 -netdev user,id=n0
```

On the DevOs console: press **Enter** at `Please press Enter to activate this
console`, then you have a dash POSIX shell and the repo busybox-cli applets plus the `dev`
package manager. Try `uname -a`, `ls /`, `ps`, `ifconfig`. `poweroff -f`
halts the machine.

## git + gh

DevOs ships a fully static **git** (built against musl with bundled
openssl + curl, so `https://` remotes work out of the box) and the official
static **gh** GitHub CLI. The image also carries a CA bundle at
`/etc/ssl/certs/ca-certificates.crt`, and `rcS` runs DHCP (with a bundled
udhcpc hook script from the rootfs overlay).

```sh
git clone https://github.com/octocat/Hello-World.git   # works out of the box
gh auth login                                           # device-flow auth
gh repo clone cli/cli                                   # gh drives git
```

The automated boot test exercises a real
`git ls-remote https://github.com/octocat/Hello-World.git HEAD` inside the
guest (DNS → TLS → GitHub) on every run.

## Package management (DevOsPM)

DevOs ships with [pm-cli](../pm-cli) built in. `/usr/bin/dev` (also available
as `/bin/dev`) launches its DevLang sources using the included static
`d` and `devrun` runtime. The package store is
`/var/lib/devos` (`DEV_ROOT`, set in `/etc/profile`).

```sh
# offline demo package (packed during the build):
dev install /root/packages/greeting-extension-1.0.0.dpk
dev run extension-hello
dev list
dev info hello
dev remove hello

# from the network (QEMU user-mode networking provides NAT + DNS):
dev install "https://github.com/d-osc/DevOsPM/releases/latest/download/greeting-extension-1.0.0.dpk"
dev run extension-hello "Dev OS"
```

Rebuild DevOsPM after changing its source and refresh the image:

```bash
wsl -d Ubuntu -- bash scripts/25-build-devospm.sh && wsl -d Ubuntu -- bash scripts/30-build-rootfs.sh
```

## How it works

1. **Kernel** — stock mainline `7.2.11`, `make defconfig` for arm64, then
   `config/kernel-fragment.config` is merged in: virtio (net/blk/console/rng),
   PL011 serial console, devtmpfs, ext4/vfat/9p, and the `-devos` localversion.
2. **Userland** — native `busybox-cli` from this repo, built with static linking,
   plus a separately built static dash POSIX shell.
3. **Package manager** — the repo's `pm-cli` sources plus a static target-built
   DevLang runtime, installed as `/usr/bin/dev` with a `/bin/dev` alias and the
   packed `greeting-extension-1.0.0.dpk` example under `/root/packages/`.
4. **rootfs** — the staged repo applets, shell and runtime + `rootfs-overlay/` (init, inittab,
   rcS, motd, os-release...), packed as `newc` cpio + gzip. Device nodes
   (`/dev/console` etc.) are emitted with the kernel's own `gen_init_cpio`
   host tool so no root is needed to build.
5. **Boot flow** — kernel runs `/init` (PID 1) → mounts `/proc /sys /dev` →
   `exec /sbin/init` (BusyBox) → `rcS` (hostname, mdev, DHCP, banner) →
   `askfirst` root shell on `ttyAMA0`.

## Customizing

- Add files to the image → drop them in `rootfs-overlay/`, re-run
  `scripts/30-build-rootfs.sh` (fast — no kernel rebuild).
- Change kernel options → edit `config/kernel-fragment.config`, then
  `rm ~/devos/linux-7.2.11/.config.devos-done && scripts/10-build-kernel.sh`.
- Bump versions → edit `scripts/common.sh`.
