# Releases

Each release has a notes file `docs/releases/<version>.md`, for example `v0.3.7.md`. Its text becomes the GitHub release
description. The directory name is set in one place, `RELEASE_NOTES_DIR` in `.github/workflows/release-manual.yml`
(`tools/release/package.py` reads the same variable and defaults to `docs/releases`).

## Cutting a release

1. Set the new version everywhere `0.3.6` appears in the version files: `package.json`, `package-lock.json`,
   `packages/*/package.json` and the fallback in `packages/config/index.ts` (`git grep 0.3.6`). The tag must be `v` plus
   the `package.json` version: the shell's build info and the updater take the version from there.
2. Write `docs/releases/v0.3.7.md` in English: what changed, what is untested on the UX3407NA (be honest), assets.
   `v0.3.6.md` is a draft for the first release from `ux3407na-dev`. The tag `v0.3.6` already exists (2026-10-05, commit
   `6561453`), so that draft must be renamed to the next version before use.
3. Commit and push to `ux3407na-dev` (or `main`).
4. In GitHub, open Actions > "Build and publish DevOs release" > Run workflow on that branch and enter `v0.3.7`.

The workflow checks, in order: the version is `vMAJOR.MINOR.PATCH`, matches `package.json`, and the notes file exists
(first job, `validate`); the CI checks on x86_64 and ARM64 (`ci.yml`); the packages; and finally publishes with
`gh release create` at the dispatched commit. Nothing is published unless every earlier job passes. Check locally with:

```bash
python tools/release/package.py check --version v0.3.7
```

## What is published

| Asset | Contents |
| --- | --- |
| `dev-os-linux-x64.tar.gz`, `dev-os-linux-arm64.tar.gz` | update packages for Settings > Updates (`tools/build/release.ts`) |
| `dev-os-patch-<from>-to-<version>-<platform>.tar.gz` | optional file-level patch from the previous release (`gjs -m dist/make-patch.js`); Settings > Updates uses it when the installed version is `<from>`, otherwise the full package |
| `devos-<version>-runtime.tar.gz` | desktop payload for the OpenEmbedded image (`tools/release/package.py`) |
| `devos-<version>-source.tar.gz` | tracked sources |
| `SHA256SUMS` | checksum of every asset |
| `SHA256SUMS.sig` | Ed25519 signature of `SHA256SUMS`, only when the `DEVOS_UPDATE_SIGNING_KEY` secret is set |
| `dev-os-system-linux-arm64.tar.gz`, `dev-os-system-linux-arm64.json` | optional system update (kernel/boot image, modules, firmware; restart needed), workflow input `build_system_bundle` |
| `devos-live-<version>-arm64-ux3407na.img.zst.part-NN`, `IMAGE-INFO.txt` | optional Live USB image, zstd-compressed and split into 1900 MiB parts (GitHub allows 2 GiB per asset), workflow input `build_image`; `IMAGE-INFO.txt` has the join and verify commands |

The update packages contain a `manifest.json` (every file with its sha256) and are what Settings > Updates installs; the
release description shown there is `docs/releases/<version>.md`. The package format, the patch format and the trust model
are described in `docs/updates.md`.

## Image and system update (self-hosted runner)

The workflow inputs `build_image` and `build_system_bundle` (both off by default) run the `image` job on a self-hosted ARM64 Linux
runner (input `image_runner`, default labels `["self-hosted","linux","ARM64","devos-image"]`). A GitHub-hosted runner cannot do this:
the OpenEmbedded build needs 100+ GB of disk and many hours, plus inputs that are not in the repository. The job runs
`tools/release/build-image-release.sh`, which performs the stages of `tools/live/release-live-usb.ps1` (OE image, staging, image, check,
export) and then builds the system update from the result (boot image from the image's EFI partition, modules and firmware from the
staged root file system).

Runner set-up: Ubuntu ARM64 with the build tools used locally (`d` DevLang, bitbake host packages, `sfdisk`, `mtools`, `e2fsprogs`
(`debugfs`), `zstd`, `gjs`, Node.js), at least 150 GB free, registered with the label `devos-image`. Set the repository variables
`DEVOS_KERNEL_BUNDLE` (kernel bundle directory, from DevOsLinuxKernel `scripts/build-snapdragon-x2.sh`) and `DEVOS_FIRMWARE_DIR`
(firmware bundle from `distro/usb/stage-x2-firmware.ps1`) to paths on that host. Only trusted collaborators may dispatch the workflow:
self-hosted runners execute repository code.

The same script runs by hand: `tools/release/build-image-release.sh --version v0.3.7 --output build/release-image`, or, from an
existing build, `--stage <staging dir> --image <exported .img> --bundle-only`. Add `--no-firmware` to leave vendor firmware out of the
public system update.

**Firmware licences.** The image and the system update contain the ASUS/Qualcomm firmware files that the Live USB needs (see
`LICENSE.qcom` inside). Check that you may redistribute them before publishing a public release; `--no-firmware` keeps them out of
the system update, but the full image still contains them.

## Signing

Installed systems that ship a public key in `data/update-keys/*.pub` only accept releases whose `SHA256SUMS.sig` verifies
with one of those keys; without a key they check HTTPS and SHA-256 only. To turn signing on:

```bash
openssl genpkey -algorithm ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out data/update-keys/release.pub
```

Store the content of `private.pem` as the repository secret `DEVOS_UPDATE_SIGNING_KEY`, commit only `release.pub`, and
delete `private.pem` from the machine. The private key never goes into the repository. From then on the workflow refuses
to publish unless the secret is set and the signature verifies with `data/update-keys/*.pub`. Images built after the key
is committed enforce signatures.

The Live USB image is not published: it needs a long OpenEmbedded build, is about 6 GB, and GitHub release assets are
limited to 2 GiB each. Build it locally with `tools/live/release-live-usb.ps1`.

## Font Awesome

`assets/` (webfonts) and `data/icons/fa/` (outlines derived from them, with `NOTICE.md` describing the licence and
provenance) are shipped in the source and runtime archives and in the update packages, like every other file. Only
tests, build outputs, `node_modules`, caches and secrets stay out of the runtime archive.

## Tag-triggered workflow

`.github/workflows/release.yml` also exists: pushing a `v*` tag builds the update packages and publishes them with
generated notes. Use one path per release, because both create the GitHub release for the same tag.
