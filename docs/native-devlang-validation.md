# Native DevLang migration validation

Validated on WSL Ubuntu Linux aarch64 with checksum-pinned DevLang **0.5.5**.
All six former Python implementations in `native/` now use DevLang; the Wayland
tracker remains C. There are no Python sources, Python shebangs or Python bytecode
in `native/` or `tools/`.

## Passed

- `tests/os-accounts.test.py`: 10 tests against DevLang fixture copies.
- `tests/app-store.test.py`: 8 tests against DevLang fixture copies.
- `tests/native-services.test.py`: 10 tests, run as root for real ownership checks.
- These **28 tests pass with both auto and AST engines**. Release CI now runs
  these checks on its Linux x64 and ARM64 runners; CI execution is still pending.
- Account/PAM integration: actual `useradd`, `chpasswd`, private 0700 homes,
  local password login, Guest login, verified GitHub login, incorrect token
  rejection and stale UID binding rejection. All mutations are confined to a
  verified private mount namespace containing copied account databases.
- Store service endpoint: signed-feed configuration, catalog allowlist, index
  refresh before install, installed/upgradable versions and rejection before
  package execution. A private opkg fixture is executed via real `posix_spawn`
  and the one-hour `timeout` wrapper; no host packages are installed.
- Descriptor checks reject symlinks, directories, non-root owners and group/other
  writable files. Account writes use `flock`, exclusive temporary files, fsync
  and atomic replacement. ARM64 and x86_64 `O_NOFOLLOW` values are handled separately.
- Real GTK 3 askpass dialog: synthetic password returned only on private stdout;
  cancellation returns failure without stdout, in a disposable Wayland session.
- `npm run build`: TypeScript checks and production bundles passed.
- All DevLang development tool entry points parse with `--validate`; compositor
  XML and the 16 GJS configuration tests pass.

## Wider regression run

`DEVOS_MEMORY_INTEGRATION=1 d tools/test/native-migration-check.dev` executed
**53 suites**: 21 Python harnesses and 32 standalone GJS bundles.
**All 53 suites passed.** The Python suites also passed using `DEVLANG_ENGINE=ast`.
The three root-only native ownership/state/Store tests are skipped in the normal
desktop-user run and pass separately in the root native run (28 tests total).

The nine legacy harnesses now execute real DevLang declarations and entry points
in isolated source/filesystem fixtures. The GTK desktop suite passes all 26
checks. It waits for asynchronous app launch and opens the current core Settings
page through the supported mount API. Manifest tests include the three added
system applications. The version-request test provisions a private release
selection, rejects invalid targets, version mismatches and failed doctor checks,
then validates the successful restart request. Its original explicit-target mode
remains available to the live update runner.

The tests exposed and verified fixes for:

- Brightness rounding at 50%, including the reported percentage.
- Real pidfd termination and stale-PID rejection through libc functions.
- Bluetooth discovery cleanup on read errors, offline USB inventory, UTF-8 names
  and the actual busctl JSON return-tuple/variant shape.
- Separate NTP/CanNTP properties, typed busctl replies, invalid dates and
  nonexistent/ambiguous DST times. Clock mutations use a private command fixture.
- Power-profile Set arguments without literal embedded quotes.
- Epoch-based MRU freshness, the systemd user cgroup path, 24-character app hashes
  and bounded, best-effort standby warming through `process_madvise`.
- System scope shell quoting, process exit status and preservation of the
  caller's session bus while contacting the systemd user manager.

All 12 memory policy tests pass with both engines and the integration flag enabled: two create real,
temporary user scopes/services and verify cgroup placement, MemoryLow,
MemorySwapMax and session-bus preservation. New zram setup uses a command fixture;
the service argument separators and UID-based rankings paths are also checked.
No host zram device is reformatted.

The native askpass launcher is a shell argv shim that invokes the DevLang body
with `--` before the sudo prompt. Both the actual shim and the real GTK dialog
are tested. Memory service and brightness callers also include the required
DevLang argument separator. Shared-library discovery skips regular files when
searching architecture subdirectories; seven tool tests pass with both engines.

Per-suite output, status JSON and the empty full failure list are in
`build/native-migration-results/`. AST outputs are in
`build/native-migration-ast-results/`; root native outputs are in
`build/native-root-results/`.

Dedicated native/live/performance fixtures are excluded from the standalone GJS
loop because they require their own runners. The account and askpass runners
were executed separately as listed above. The 2026-10-22 OE rebuild completed
all 11,595 tasks. An offline audit verified that its installed desktop helpers,
native services, shared libraries and DevLang 0.5.5 binaries match current sources.
The staged ARM64 USB image reached the root Wayland desktop in QEMU and passed
checks for the locked base root, RAM-overlay password/PAM, installed account/Store
service boundaries, Wi-Fi helper/UI, audio services, default tools, zram, memory
policy and shell swap protection. The final boot runner passed after correcting
a test-only initramfs logging hook error; the USB image itself was unchanged.
First-user provisioning through greetd, real GitHub authorization, real opkg
installation and physical UX3407NA device operation remain untested on this image.

## Reproduce the native checks

```sh
sudo env PATH="$PATH" d tools/test/native-migration-check.dev -- --native-only
sudo env PATH="$PATH" DEVLANG_ENGINE=ast d tools/test/native-migration-check.dev -- --native-only
sudo env PATH="$PATH" d tools/test/os-accounts-integration.dev
d tools/test/native-services-smoke.dev
DEVOS_MEMORY_INTEGRATION=1 d tools/test/native-migration-check.dev
DEVLANG_ENGINE=ast DEVOS_MEMORY_INTEGRATION=1 d tools/test/native-migration-check.dev -- --python-only --output build/native-migration-ast-results
```

The integration runner requires existing empty mount points `/usr/share/dev-os`,
`/usr/libexec` and `/var/lib/devos`. It stages the current sources itself without
installing production services. Actual installation uses the updated OE recipe
or `tools/setup/bootstrap-accounts.sh`, which requires a root-owned DevLang
runtime at `/usr/bin/d` and `/usr/bin/devrun`.
