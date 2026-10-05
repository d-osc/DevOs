# Performance

The normal shell build uses minified production React. Watch builds and
`node tools/build/build.ts --development` retain development checks for debugging.

GTK updates now preserve signal connections, unchanged icons, styles and widget
properties. Only packing changes reorder box children. Controlled entries and
scales still restore their values, and callback replacements take effect immediately.
Files memoizes rows/cards and filtered lists; directory sorting reuses a numeric
collator instead of constructing one for every comparison.

The launcher and panels share a desktop application catalog, invalidated by
GIO's application monitor. Search metadata is prepared once for each application.
Installing applications refreshes the catalog without restarting the shell.

Commands use a small D-Bus interface on the running shell. Shortcut processes
load Gio/GLib and send arguments plus their working directory, avoiding GTK,
React and extension discovery. Older shells fall back to GApplication forwarding.
Startup also shares extension preferences and imports system modules concurrently,
while preserving their activation order.

`dev.ps1 run` and `demo` use `node tools/build/build.ts --if-needed`. The build cache
hashes source, build configuration, lockfiles and release/build mode, then checks
the generated runtime outputs. A changed input or missing/modified output triggers
a full build with all TypeScript checks. `npm run build` always builds and checks.

## Measurements

Measured on the same Windows/WSL machine on 2026-10-05, using a runtime staged on
the Linux filesystem and a headless labwc compositor with software rendering.
These are diagnostic samples, not timing guarantees or frame-rate measurements.

| Workload | Before | After |
| --- | ---: | ---: |
| 200 native GTK rows, 30 selection updates | 6,889 ms | 99 ms |
| 1,000 applications, 200 search queries | 240 ms | 49 ms |
| Session launch to shell-ready message | 941 ms | 552 ms |
| Existing-shell command, median of 8 | 198 ms | 47 ms |
| Launcher toggle command, median of 8 | 202 ms | 53 ms |
| Files command, median of 3 | 184 ms | 81 ms |

The React/GTK bundle decreased from 760 KiB to 153 KiB. Checking an unchanged
build took about 188 ms. Command timings measure dispatch and synchronous UI
creation, not the time for an external application's complete startup or a
directory's asynchronous read to finish. Timings vary with machine load and caches.

## Repeat the benchmark

On Linux, after building and preparing the native dependencies:

```sh
npm run build
PATH="$PWD/build/wsl/bin:$PATH" python3 tools/test/performance.py
```

For a staged WSL runtime, run the same script with `--root /tmp/dev-os-runtime-...`
and include that runtime's `build/wsl/bin` in PATH. The script creates an isolated
configuration and headless session, prints JSON, and stops its own processes.
It does not change user settings. `tests/performance.test.tsx` is the native
renderer/search workload; it intentionally has no machine-specific timing assertions.

Validation includes TypeScript checks, config/extensions/update/store tests,
native GTK integration tests and the keyboard smoke test on one and two outputs.
Regression checks cover unchanged icons, controlled inputs, callback replacement,
cached launcher selection, editor paths with spaces and caller cwd, and remote
commands with the React runtime absent from the client.
