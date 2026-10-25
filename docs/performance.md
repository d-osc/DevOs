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
PATH="$PWD/build/wsl/bin:$PATH" d tools/test/performance.dev --
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

## Resource measurements 2026-10-25 (swap, wallpapers, helpers)

Measured in WSL2 Ubuntu aarch64 on the dev machine (Snapdragon-class, not the UX3407NA), headless labwc with pixman, `measure.sh`-style
sampling of `/proc` (30-40 s after shell-ready, whole-session total over all session processes). Run twice, not averaged, noise about +-0.5%.
Real GPU, 2880x1800 output, battery, thermal state and the Live USB's RAM overlay were **not** measured.

**Wallpaper drawing cost** (`gjs -m dist/wallpaper-bench.js`, 2880x1800, one frame, % of one core at the frame rate used):

| Style | Before (50 ms) | After |
| --- | ---: | ---: |
| Flow / Ripples / Fireflies / Tide / Planets | 28-46 % | 7-10 % (10 fps) |
| Starfield / Galaxy / Eclipse | 37-74 % | 10-11 % (10 fps) |
| Nebula | 100 % (66 ms per frame, could not hold 20 fps) | 19 % |
| Meteors | 42 % | 12 % (15 fps) |
| Matrix / Terminal / Circuit / Radar / Network | 43-45 % | 12-17 % (15 fps) |

**Whole headless session** (output size is the compositor default, so drawing is much cheaper than on the panel):

| Case | Before | After |
| --- | ---: | ---: |
| Static wallpaper: CPU / RSS / PSS of all processes | 1.6 % / 455 MB / 322 MB | 2.0 % / 427 MB / 306 MB (no meaningful CPU change) |
| Matrix: CPU / RSS / PSS | 35.8 % / 1261 MB / 727 MB | 37.2 % / 1031 MB / 613 MB |
| Nebula: CPU / RSS / PSS | 46.4 % / 1289 MB / 746 MB | 29.9 % / 822 MB / 506 MB |

Honest reading: the draw function got 2-5x cheaper, but in the headless session Matrix did **not** get cheaper overall, so what remains there is
not the Cairo drawing (suspect: GTK committing a new software buffer per frame; the animated sessions hold 150-300 MB of shared-memory
buffers in `main.js` and labwc, which the static session does not). That was not investigated further. Animated wallpapers are therefore
still the largest single CPU and RAM cost of the session; a static design costs nothing. The idle static session is dominated by the
main shell `gjs` (about 150 MB PSS, 1.5-2 % CPU) and the supervisor `gjs` (about 30 MB PSS).

Other changes with no number (not measurable here): Settings pages are unmounted when the window is hidden (their pollers, 3-60 s per card,
used to keep running); `devos-memory` sleeps 30 s instead of 5 s without managed apps; the speaker daemon skips `pw-dump` when it cannot need it;
`devos-battery-care` is skipped on machines without a charge limit; background helpers are `Nice=10`, low CPU/IO weight and memory-limited;
apps start at `OOMScoreAdjust=300`; sysctl tuning for zram, reclaim and dirty-page limits. `tests/wallpaper-bench.test.ts` fails if any style
needs more than half a core at 2880x1800.
