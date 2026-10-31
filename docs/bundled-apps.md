# Bundled desktop applications

## Base developer tools

The base image ships Git, the DevOs package manager (`dev`), DevLang 0.5.5
(`d`, `devrun`, `devc`) and GitHub CLI 2.102.1 (`gh`) in `/usr/bin` alongside
the desktop. DevLang recipes are pinned to upstream release archives with
SHA-256 verification and provenance recorded in `/usr/share/devlang` and
`/usr/share/gh`. GitHub CLI uses the system CA store and Git for repository
operations.

### Not in the image

To keep the image small the desktop image no longer ships VS Code, Google Chrome,
Rust (`rustc`, `cargo`, the Rust standard library and the LLVM it pulled in), Node.js,
`nvm`, Python (interpreter, `pip`, `venv`) and the GCC toolchain that Rust required.
QEMU was never part of the image; it only runs on the development host (`qemu.ps1`,
the `devos-qemu` MCP server). Install language toolchains per user or on the host
instead. DevLang (`d`) is the project's scripting and native language and stays in
the image.

The Settings helpers `dev-os-display-care`, `dev-os-keyboard`, `dev-os-microphone`,
`dev-os-speaker` and `dev-os-touchpad-gestures` were Python scripts and are now DevLang
programs (`lib/*.dev`, started by small `sh` launchers in `bin/`, because `d` takes
program arguments only after `--`). `lib/hw.dev` (processes, JSON state, numbers),
`lib/pwaudio.dev` (PipeWire graph) and `lib/wayland.dev` (Wayland wire protocol over
libc FFI, including SCM_RIGHTS) are shared. The image installs no `python3-*` package, and
`bbappend`s in `recipes-support/nopython` drop the optional `python3-core` dependency of
`btrfs-tools`, `xfsprogs`, `libpwquality` and `ibus`. `tests/oe-image-toolchains.test.py`
guards this.

## Desktop applications

Base applications run in separate processes from the desktop shell and OS
services. See [Desktop process boundaries](process-isolation.md) for lifecycle,
IPC, preference synchronization and crash-isolation tests.

The `devos-image` desktop ships only Dev OS's own apps (Terminal, Editor, Files,
Settings, Camera, Screenshot (Super+Shift+S, see `docs/screenshot.md`), Task Manager and so on). The Editor is a native DevLang window (a GTK code view colored by DevLang from the theme), not VS Code and not WebKit. The native Dev OS Browser uses WebKitGTK with tabs, web search and navigation. Open it from the Launcher or run `dev-os-shell browser`. The small console recovery image does not
include graphical applications.

Build the desktop image normally:

```powershell
.\distro.ps1 desktop-prepare
.\distro.ps1 desktop-check
.\distro.ps1 desktop-build
```

Validation:

- `bash distro/oe/build.sh --parse` checks recipes and the image dependency graph.
- `python3 tests/oe-image-toolchains.test.py` checks that the removed components stay out of `IMAGE_INSTALL`.
- A full image build and target boot are separate from development-host testing.
