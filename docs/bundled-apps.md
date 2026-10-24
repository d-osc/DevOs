# Bundled desktop applications

## Base developer tools

The base image ships Git, the DevOs package manager (`dev`), DevLang 0.5.5
(`d`, `devrun`, `devc`) and GitHub CLI 2.102.1 (`gh`) in `/usr/bin` alongside
the desktop. DevLang recipes are pinned to upstream release archives with
SHA-256 verification and provenance recorded in `/usr/share/devlang` and
`/usr/share/gh`. GitHub CLI uses the system CA store and Git for repository
operations.

### Language toolchains

The OpenEmbedded `devos-image` (not the minimal `distro/base` console
initramfs, which carries no Git either) also installs, from the pinned
openembedded-core / meta-openembedded (`meta-oe`) layers:

- Python 3.14 with `pip`, `venv`, `ensurepip` and the full stdlib
- `nvm` 0.40.8 (Node Version Manager) in `/usr/share/nvm`; Node.js is not preinstalled, run `nvm install --lts` (official linux-arm64 builds, needs network)
- Rust 1.94 (`rustc`) and `cargo`; OE's `rust` package also pulls in
  `gcc`, `g++` and `binutils` so cargo can link.

Verify on a booted image:

```sh
python3 --version && python3 -m pip --version && python3 -m venv /tmp/v
nvm --version && nvm install --lts && node --version
rustc --version && cargo --version
```

Cost: expect roughly +1 GB of rootfs (rustc/std ~400 MB, gcc/g++ ~250 MB,
Python modules already shipped) and, on a cold sstate cache,
several extra hours of build time (target `rust` compiles
LLVM; `rust-native` is also built). Warm sstate rebuilds are fast.
`IMAGE_ROOTFS_EXTRA_SPACE` already leaves headroom. These sizes are estimates
until measured from a real build.

## Bundled desktop applications

The `devos-image` desktop image includes Google Chrome 155.0.8059.84 and
Microsoft Visual Studio Code 1.142.0. Both appear in Applications, run as the
session user, and use native Wayland. `code .` opens the current directory.
The small console recovery image does not include graphical applications.

The recipes in `distro/oe/meta-devos/recipes-apps/vendor/` support ARM64 and x64.
They fetch official vendor packages using pinned release URLs and SHA-256
checksums, and copy only application files/icons/MIME data into the image.
Debian package installation scripts, repositories and a Debian root filesystem
are not included. OpenEmbedded builds the runtime libraries as part of DevOs.
X11 client libraries are included because the vendor binaries link them, while
the launchers select Wayland. Chromium/Electron sandboxing remains enabled.
Chrome uses GTK desktop integration; its optional Qt5/Qt6 theme adapters are
omitted because this image does not ship either Qt runtime. Both vendor packages
declare their Bash launcher and hicolor icon theme dependencies.
The vendor recipes retain upstream binaries and their included license notices;
their recipe license is `CLOSED`, separate from DevOs and upstream runtime libraries.

Build the desktop image normally:

```powershell
.\distro.ps1 desktop-prepare
.\distro.ps1 desktop-check
.\distro.ps1 desktop-build
```

Updating the bundled versions requires updating each recipe's version/URL and
both architecture checksums, then rebuilding the image. The image does not use
the vendor apt repository for updates.

For the WSL development host, `dev.ps1 run` calls
`tools/setup/bootstrap-desktop-apps.sh` as WSL root only to prepare missing Linux
applications. Those apt-based helpers are for the host, not the target OS.
VS Code lives in `/usr/lib/devos-vscode`, with `/usr/share/code` linking there.
The recipe removes foreign-architecture search tools and rebuilds the bundled
seccomp helper from source for the target, using libseccomp-native to generate
its BPF filter. Architecture and library-location QA remain enabled.
VS Code uses `/usr/share/code/bin/code`; DevOs owns its `/usr/bin/code` wrapper
in the target to avoid recursion and select Wayland. The upstream `code.desktop`
entry is hidden in favor of the DevOs entry to avoid duplicate launcher results.

Validation:

- `bash distro/oe/build.sh --parse` checks recipes and the image dependency graph.
- `d tools/test/vendor-apps-packaging.dev -- /var/tmp/devos-vendor-apps`
  validates both architectures' official archives/checksums and executes the
  actual recipe install bodies in temporary roots, including sandbox permissions.
  This also requires `apply-seccomp-arm64` and `apply-seccomp-amd64` in that
  directory, copied from each target recipe's build output (`apply-seccomp`).
- `d tools/test/bundled-apps-smoke.dev --` opens isolated Chrome and VS Code
  profiles inside a private DevOs Wayland session, verifies both native windows,
  captures screenshots in `build/bundled-apps/`, and closes only its own processes.
- A full image build and target boot are separate from development-host testing.

Official package sources: [Chrome for Linux](https://www.google.com/chrome/)
and [VS Code for Linux](https://code.visualstudio.com/docs/setup/linux).

Chrome launcher actions use `bin/dev-os-browser`. WSL uses `--disable-gpu`
to avoid inaccessible EGL devices in nested sessions; native Linux keeps its
normal GPU selection. `DEV_OS_BROWSER_SOFTWARE_RENDERING=0` overrides this,
and `1` forces software rendering. The browser sandbox remains enabled.

The compositor skips persistent close-animation buffer caches for Chrome,
Chromium and VS Code. Keeping those client buffers locked can prevent their next
frame from being submitted. Opening animations remain enabled; closing uses
whatever live scene data is still available at unmap.

Run `d tools/test/bundled-apps-smoke.dev -- --web` to verify that a real Chrome
Wayland window loads GitHub sign-in over HTTPS with an isolated test profile.
