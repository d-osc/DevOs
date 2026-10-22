# DevLang development tools

All tool sources formerly written in Python now use DevLang `d` 0.5.5 or newer.
Run arguments after `--`, for example:

```sh
d tools/test/check.dev
d tools/test/runtime-env-test.dev
d tools/test/smoke.dev -- --keyboard --screenshots build/screenshots
d tools/maintenance/migrate-config.dev -- --source ~/.config/dev-os/config.toml
d tools/maintenance/install.dev -- --prefix ~/.local
```

`check.dev` validates tool entrypoints without running their actions, validates
compositor XML through the system XML parser (PowerShell on Windows), and runs
GJS configuration/extension tests on Linux. `--validate` is a parsing-only mode
for individual migrated tools. The default smoke runner retains renderer and
UI assertions. `--skip-ui-tests` explicitly skips those two suites to isolate
session/CLI/keyboard diagnostics and prints a SKIP line.

Shared modules in `tools/lib/` implement child processes, bounded QMP messages,
private session cleanup, virtual pointer input, image inspection, feed staging
and PAM conversations. They use the actual DevLang source runtime, libc/system
libraries and native command-line programs. Windows supports syntax/XML checks
and TOML migration; native desktop, packaging and installation tools run on Linux
or inside WSL. Keep `tools/lib/` and the repository's `lib/` with the tools.
The labwc patch installers are standalone so OE can stage them beside their assets.

Smoke sessions use private runtime/config directories. Account integration
requires root but verifies a separate mount namespace before binding private
`/etc`, `/home`, account state and a native-service fixture. Live USB checks use
QEMU and immutable images or temporary disk overlays. Feed publication stages
and signs files only; it does not upload or install packages.

Production account/PAM and App Store services in `native/` also use DevLang.
Python files in `tests/` are external test harnesses. Native service regressions
invoke DevLang fixture copies; account/PAM integration stages current services
inside a private mount namespace. `native-services-smoke.dev` verifies GTK askpass
accept/cancel and `native-migration-check.dev` collects Python and standalone GJS
regression outcomes under `build/native-migration-results/`.
