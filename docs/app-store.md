# Native DevOs App Store

App Store displays a bundled, read-only preview of the DevOsAppStore authoring registry alongside the signed native IPK catalog. The native catalog remains empty until an actual signed repository is provisioned. Registry entries expose an explicit user-level Install flow through DevOsPM. Upstream downloads are never routed through opkg.

Open Applications > App Store or run `dev-os-shell app-store`. Search, categories, details, installed apps and update views use the administrator-managed DevOs catalog. Installs, removals, package index refreshes and upgrades require polkit administrator authentication. The root service accepts only app IDs in the trusted catalog, maps them to validated package names, blocks core OS packages, and requires a matching HTTPS feed with signature verification enabled. Native packages are system-wide. No arbitrary shell commands are accepted.

In WSL the store is a preview. Native DevOs IPKs must not be installed into the Ubuntu development host. Package operations become available in the booted DevOs image after a signed repository is configured. The OE image enables package-management and opkg GPG, HTTPS and SHA256 support.

## Prepare a feed

Build application IPKs and their dependencies with the same pinned OpenEmbedded sources and target ABI as the DevOs image. Do not use packages built for a different Linux distribution. Add real applications to a copy of `config/app-store.json`:

```json
{"schemaVersion":1,"source":{"name":"DevOs","url":""},"apps":[{"id":"org.devos.Example","name":"Example","package":"devos-example","category":"Productivity","description":"Your actual app description","desktopId":"org.devos.Example.desktop","removable":true}]}
```

This is a schema example, not an app included in the shipped catalog. A website is optional and must use HTTPS. Keep core OS components out of the application catalog.

Use GPG with a signing key you control, and opkg-make-index from opkg-utils-native. Run the publisher from the OE native tool environment where opkg-make-index and its Python modules are available:

```sh
d tools/store/publish.dev -- \
  --packages /path/to/deploy/ipk/all \
  --packages /path/to/deploy/ipk/aarch64 \
  --packages /path/to/deploy/ipk/qemuarm64 \
  --architecture all --architecture aarch64 --architecture qemuarm64 \
  --catalog /path/to/your-app-catalog.json \
  --output /path/to/new-feed-release \
  --url https://YOUR-REAL-HOST/devos/your-release \
  --key YOUR-GPG-KEY-ID
```

Replace paths, architectures and URL with real values. The publisher refuses an existing output directory, missing packages, invalid catalog entries and incompatible architectures. It generates Packages, Packages.gz, a GPG Packages.asc signature, a signed app-store.json, the public signing key, package checksums, and an opkg configuration. Private keys stay in the signing keyring. Publish the resulting directory to the specified HTTPS URL only after review. The tool does not upload, change a running OS, or generate signing keys automatically. Include all transitive runtime dependencies; catalog validation alone does not resolve the package dependency graph.

## Provision DevOs

On the native DevOs machine, an administrator must independently verify the signing public key fingerprint, verify app-store.json.asc against that trusted key, import the public key with opkg-key, then install the verified app-store.json and reviewed app-store-opkg.conf as root-owned mode 0644 files at `/etc/devos/app-store.json` and `/etc/devos/app-store-opkg.conf`. The signature check option must stay enabled. Keep architecture declarations compatible with the installed image. App Store can then refresh the index and install the catalog's real packages. Do not configure a feed until its complete signed content is available over HTTPS.

The public repository, signing identity and application packages remain to be created/provided; a new DevOs image must also be built and booted for end-to-end native installation validation. No native IPK application is currently advertised as installable; upstream registry downloads use the separate DevOsPM flow below.

## Validation

`npm run build`; `python3 tests/app-store.test.py`; `GDK_BACKEND=wayland gjs -m dist/app-store-test.js`. Tests cover catalog allowlisting, protected packages, administrator requirements, source/signature requirements, native-versus-WSL separation, UI confirmation and cancellation. Package mutations use mocks until a real native test image and signed repository exist.

## Package files and the Packages tab

The App Store window also installs **local package files** (`.dpk`, `.deb`, `.rpm`, `.tar.gz`) for the current user through `dev`, outside the signed native catalog above. Double-click such a file in Files (or right-click > Install, or drop it on the App Store window) to open the **Install Package** window; App Store > **Packages** lists what was installed this way with Remove and Roll back. These packages are unsigned user-level installs and never use polkit or opkg. Formats, trust statement and limits: `docs/package-install.md`.

## DevOsAppStore and DevOsPM

Discover includes the six authoring entries from DevOsAppStore: ChatGPT, Chrome, Claude Desktop, Firefox, Visual Studio Code and ZCode. Search includes aliases, tags, publishers and categories; Developer Tools has its own category. Details show publisher, license, compatibility notes and the registry README as plain text (no executable HTML or Markdown). Only validated HTTPS project links can be opened.

Registry apps expose **Install** when a supported HTTPS ARM64 source and DevOsPM are available. Install first shows the publisher URL and compatibility/trust statement. **Download and review** downloads to a private temporary directory (HTTPS redirects only, 2 GiB / 10 minute limits), inspects the actual file and shows its package identity, version, architecture, dependencies and replacement status. A second confirmation invokes `dev install` on those reviewed bytes. Redirect endpoints without a suffix (including VS Code) work because the downloaded local filename uses the declared format. Installation is limited to ARM64 systems and rejects a mismatched payload architecture. Compatibility remains untested; installation does not certify the application will run.

`RegistryManager` records only registry ID → actual installed package name, scoped by the effective PM store root. `dev list --json` remains the source of installed versions and commands. After installation the detail page switches to **Open / Uninstall / Roll back** as applicable. Uninstall confirms and calls `dev remove ACTUAL_NAME`; it never guesses from a display name or registry ID. Installed includes all PM applications, including packages installed outside App Store, and the native inventory. Packages also includes extensions. Refresh or switching tabs rereads PM state. Native updates retain the separate signed-feed flow.

The adapter follows DevOsPM `src/main.rs`, `manager.rs`, `native.rs`, `download.rs`, and `desktop.rs`: user store precedence is DEV_ROOT → XDG_DATA_HOME/devos → ~/.local/share/devos; `--replace` retains one previous generation; remove cleans launchers/shims; PM skips native package scripts/links and does not resolve dependencies. It accepts `.dpkx` as the `.dpk` tar+gzip alias. Debian control inspection supports gzip, xz and zstd (xz/zstd tools ship in the image), so package names do not come from temporary filenames. A PM inventory/inspection error aborts installation rather than being treated as an empty store.

All six current upstream entries lack pinned registry checksums and verified DevOs compatibility. The UI discloses this before downloading. The bundled registry is an authoring snapshot, not a signed feed or automatic remote updater. The adapter does not silently elevate catalog entries to verified releases, run shell instructions from metadata, or write PM's registry.json. Download cancellation after review and completion/failure clean up staged files.

Refresh the bundled metadata deliberately after reviewing the source registry:

```sh
node tools/store/import-registry.mjs ../DevOsAppStore
npm run build
node --test tests/app-registry.test.mjs
```

The importer accepts an optional source directory, checks real paths against the registry root, limits document sizes, imports only apps (never examples), and records the source commit (null before the first commit) and dirty state in generated `registry-data.ts`. The generated data ships inside the App Store bundle, so installed images do not need the sibling checkout. Refresh in the app reloads native state; changes to the bundled registry require importing and rebuilding.


End-to-end adapter validation with the actual DevOsPM binary and a temporary user store:

```sh
DEV_OS_PM=/path/to/DevOsPM/target/release/dev xvfb-run -a gjs -m dist/registry-pm-test.js
```

The test stubs only network transport. It installs real dpkx and xz-compressed Debian fixtures through DevOsPM, checks inspection, replacement, rollback, persisted identity, Install/Uninstall UI confirmation and launcher removal. It does not install or launch the six upstream applications on a native DevOs image.


## WSL runtime setup

`dev.ps1 run` prepares the package manager before staging the desktop, using `tools/setup/bootstrap-pm.sh`. The helper builds the sibling DevOsPM checkout with Cargo and its lockfile, then installs its `dev` binary privately at `build/wsl/bin/dev`. Set `DEV_OS_PM_SOURCE` to use another checkout. It skips rebuilding when the installed binary is current. It does not replace `~/.local/bin/dev`, which can be DevLang's alias.

To prepare it explicitly:

```sh
sh tools/setup/bootstrap-pm.sh
```

App Store searches PATH, its runtime `bin/dev` and `build/wsl/bin/dev`, the user's local bin directory, and standard system locations. It checks `dev --version` before sending package commands, skips a DevLang alias that reports `d VERSION`, and caches successful validation by file modification time/size. `DEV_OS_PM` remains an explicit executable override and is validated too. The actual native image continues to provide `/usr/bin/dev` through its package-manager recipe.

The UI regression test activates the real App Store extension and opens both Store and Install Package windows, including GTK file-drop registration, in addition to the component and package-manager tests.


## Extensions

App Store → Extensions displays listings from DevOsAppStore, including Workspace Notes. The importer reads extensions/*/listing.json, runtime manifests, README and icons. Search covers catalog names, descriptions, publishers and tags. Manual repository input is removed; published entries offer Check availability, while local drafts show Not released yet. Previously connected extensions remain manageable under Your extensions. The verified GitHub release lifecycle and existing preferences are preserved. Reimport, rebuild and reopen AppStore after changing authoring data. See [extension delivery](extension-store.md).
