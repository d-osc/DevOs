# Native DevOs App Store

The standalone App Store now uses native IPK packages through opkg. It does not use Flatpak or any third-party app catalog. The current catalog is intentionally empty: no repository URL or actual app packages have been published yet.

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

The public repository, signing identity and application packages remain to be created/provided; a new DevOs image must also be built and booted for end-to-end native installation validation. No application is currently advertised as installable.

## Validation

`npm run build`; `python3 tests/app-store.test.py`; `GDK_BACKEND=wayland gjs -m dist/app-store-test.js`. Tests cover catalog allowlisting, protected packages, administrator requirements, source/signature requirements, native-versus-WSL separation, UI confirmation and cancellation. Package mutations use mocks until a real native test image and signed repository exist.

## Package files and the Packages tab

The App Store window also installs **local package files** (`.dpk`, `.deb`, `.rpm`, `.tar.gz`) for the current user through `devospm`, outside the signed native catalog above. Double-click such a file in Files (or right-click > Install, or drop it on the App Store window) to open the **Install Package** window; App Store > **Packages** lists what was installed this way with Remove and Roll back. These packages are unsigned user-level installs and never use polkit or opkg. Formats, trust statement and limits: `docs/package-install.md`.
