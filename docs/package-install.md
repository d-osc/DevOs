# Installing package files (.dpk, .deb, .rpm, .tar.gz)

Double-clicking a package file in **Files**, or right-clicking it and choosing **Install**, opens the **Install Package** window of the App Store extension. The window shows what is in the file, asks for confirmation, installs for the current user only, and offers **Open app** when the package ships a launcher. Installing from a file is not the same as updating Dev OS (Settings > Updates, `docs/updates.md`) and not the same as the signed native catalog of the App Store (`docs/app-store.md`).

## What exists and how it fits together

| Piece | File | Role |
| --- | --- | --- |
| Package manager | `dev` / `dev` v0.6.4 (sibling project DevOsPM, recipe `devos-pm_0.6.4.bb`) | Does the actual extraction and registry work. Reads `.dpk`, `.tar.gz`, `.deb` (gzip/xz/zstd) and `.rpm` natively, with no `dpkg`, `rpm`, `ar`, `cpio` or Python in the image. |
| Inspection | `src/apps/org.devos.appstore/package-file.ts` | Read-only: lists archive entries and parses `package.json`, deb `control`, rpm headers. Uses only GLib/Gio (zlib). Never extracts, never runs anything. |
| Backend bridge | `src/apps/org.devos.appstore/package-backend.ts` | Runs `dev install/list/remove/rollback` (override the binary with `DEV_OS_PM` for tests), streams its progress lines, parses its output. |
| Install page | `package-view.tsx`, `extension.tsx` | `Install Package` window (`dev-os-shell package-install <files...>`), queue, Packages tab in the App Store, drag and drop. |
| Files | `src/apps/org.devos.files/package-open.ts`, `context-menu.ts`, `view.tsx`, `index.ts` | Double-click/Enter routing and the **Install** context-menu item (`contextInstall`, Font Awesome `download` through `system-software-install-symbolic`). |
| Desktop integration | `data/applications/dev-os-package-install.desktop`, `data/applications/mimeapps.list`, `data/mime/packages/org.devos.package.xml`, `devos-shell_0.3.6.bb` | Default handler for `xdg-open` / other apps, and the `.dpk` MIME type. |

The `.dpk` format is the DevOsPM package format: a gzip-compressed tar with a `package.json` manifest at the archive root (name, version, kind `app` or `extension`, `bin`, `icon`, optional `contextmenu`, ...). `.tar.gz` is the older form of the same layout. A `.dpk` that is not really tar + gzip is rejected.

## Behaviour

* **Double-click / Enter** on `.dpk`, `.deb`, `.rpm` opens the install page. For `.tar.gz` see the rule below. Folders named `x.dpk` are folders and just open.
* **Right-click > Install** appears only on files of those types (and installable `.tar.gz`), never on folders or the empty background. It can be switched off in Settings > Files (`contextInstall`).
* The page first *reads* the package (no installation): format, name, version, architecture, file size, file count and unpacked size, description, dependencies, exported commands or launcher, install location, trust statement, warnings, and blockers. Install stays disabled while there are blockers.
* **Install** runs `dev install [--replace] <absolute path>`; progress lines are shown live and Cancel is disabled while it runs (the package manager has no abort). An already installed package is replaced and its previous version is kept for rollback.
* **Open app** launches the first exported command through `dev-<command>.desktop`, which `dev` writes to `~/.local/share/applications`.
* **Several files**: `dev-os-shell package-install a.dpk b.deb` and repeated double-clicks while the window is open **queue** the files in one window (`Package 1 of N`, **Next package**). Installs are sequential and every one needs its own confirmation. Files has single selection, so multi-select is not applicable inside Files itself.
* **Drag and drop**: dropping package files from Files onto the App Store window or the Install Package window opens/queues them.
* **Installed list / uninstall / rollback**: App Store > **Packages** lists user-level packages from `dev list --json` with **Remove…** (confirmation) and **Roll back to x** buttons. Extensions installed from `.dpk` (kind `extension`) are listed too; they load after the next Dev OS session restart.
* `dev-os-shell package-install` with no file just raises an open Install Package window.

### The `.tar.gz` rule

A `.tar.gz` is a generic archive, so Dev OS only treats it as a package when it looks like one:

1. a `package.json` or `dev-package.json` at the **archive root**, or
2. a `*.desktop` file at most four directories deep.

The check reads at most 400 entries / 8 MiB of decompressed data (cached per file and modification time). If that budget is exhausted before an answer, the file is treated as installable and the install page makes the full decision. Unreadable or plain archives keep their existing behaviour (double-click goes to the default application; there is no Install menu item). For this reason `.tar.gz` / `application/gzip` is **not** listed in the desktop file's `MimeType=`: other applications opening a plain tarball are never sent to the installer. The Install Package page itself still refuses a `.tar.gz` without those markers.

## MIME and default application

* `.dpk`: new type `application/x-devos-package` (glob `*.dpk`, sub-class of `application/gzip`), shipped as `data/mime/packages/org.devos.package.xml`. The shell recipe installs it to `/usr/share/mime/packages` and `inherit mime` runs `update-mime-database` on the target. Files does not depend on this: it routes by file name.
* `.deb`: `application/vnd.debian.binary-package` (also `application/x-deb`), `.rpm`: `application/x-rpm` (also `application/x-redhat-package-manager`), both already known to shared-mime-info.
* `dev-os-package-install.desktop` (`NoDisplay=true`, `Exec=dev-os-shell package-install %F`) claims those types, and `data/applications/mimeapps.list` makes it the system default for them (the session puts `<root>/data` first in `XDG_DATA_DIRS`; a user's own `~/.config/mimeapps.list` still wins).

## Trust and limits (what Dev OS does and does not promise)

Common to all formats:

* Installation is **per user**, into the `dev` store (`$DEV_ROOT`, else `$XDG_DATA_HOME/devos`, else `~/.local/share/devos`), plus a launcher `.desktop` in `~/.local/share/applications`. Nothing is installed to `/usr`, no root, no polkit.
* **No package script is ever executed**: no `preinst/postinst/prerm/postrm`, no RPM scriptlets, no hooks. Dependencies are never resolved or installed; a binary that needs a library missing from the image will simply fail to start.
* Extraction is done by `dev`, which refuses absolute paths, `..`, backslashes, duplicate/case-colliding paths, sparse/PAX link metadata, more than 100,000 files or 2 GiB, and oversized manifests, extracts into a staging directory and records SHA-256 hashes (`dev verify`). The install page runs the same path rules before offering **Install** (blockers), but `dev` is the enforcement point.
* **There is no signature check.** `.dpk` and `.tar.gz` have no signature format; Debian packages are not signed individually; RPM signatures are detected but **not verified**. The page says so for every file. Only install files from sources you trust: an installed app runs with your user's permissions.
* The installer window is separate from **Install Dev OS** (`org.devos.installer`) and from the OS update system.

Per format:

| Format | Info shown | Honest limits |
| --- | --- | --- |
| `.dpk` | Manifest fields, file count, size, commands | Links/special files are rejected (not skipped). No signature. `kind: extension` packages go to the Dev OS extension store layout and need a session restart. |
| `.tar.gz` | Same as `.dpk` when `package.json` is present; otherwise name from the file name, version `0.0.0` | Only installable if it matches the rule above. No signature. |
| `.deb` | `control` fields (needs gzip `control.tar`; for xz/zstd the page says details appear after install), maintainer-script names, file list when `data.tar` is gzip | Built for Debian/Ubuntu: different libc and libraries, so the program may not start here. Scripts not run, dependencies not installed, symlinks skipped. Commands come from `usr/bin`, `usr/sbin`, `usr/local/bin`, `bin`, `sbin`. |
| `.rpm` | Name, version-release, arch, summary, license, dependencies, scriptlet names, file list and signature presence from the RPM header | Same as `.deb` (Fedora/RHEL/SUSE). Payload compression gzip/xz/zstd (not bzip2) as supported by `dev`. |

Tools in the image: none of `dpkg`, `rpm`, `ar`, `cpio`, `xz`, `zstd` or Python is needed; `dev` is statically linked and decodes the formats itself, and the page uses only GLib's built-in zlib. Nothing had to be added to the image recipes except the MIME package. If `dev` is missing (for example a trimmed image or WSL) the page reports that the package manager is not installed instead of failing silently.

## Validation

`npm run build`, then under Xvfb: `gjs -m dist/package-install-test.js` (kinds, MIME/desktop/recipe checks, tar/ar/rpm parsers, traversal, links, huge-size and truncated archives, `.tar.gz` rule, Files routing and context menu, backend bridge with a fake `dev`), `gjs -m dist/package-install-ui-test.js` (review/blockers/progress/result/failure/queue and the Packages list), plus the existing `files-settings-test` and `app-store-test`. Not covered: a real `dev` extraction on the target and double-click inside the booted Live image.

## Uninstall from the Applications list

Right-clicking an app in the launcher's Applications list (list or grid view) shows **Uninstall** only for apps that `dev` installed for the current user: a regular, non-symlink `dev-<command>.desktop` in `~/.local/share/applications` whose `Exec` is `... --root <store> run <command>`. Base apps (`dev-os-*.desktop`, image packages, system entries) get no menu at all. Choosing Uninstall asks for confirmation inside the launcher, then runs `dev remove <package>` (which also removes the launcher entry); the app disappears from the list. Packages whose command name starts with `os-` would be treated as base apps and are not offered. Code: `src/apps/org.devos.launcher/uninstall.ts`; test: `launcher-uninstall-test`.
