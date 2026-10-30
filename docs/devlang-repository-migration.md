# Repository migration to DevLang

The native login candidate now lives in `src/system/login/`. Its DevLang JSX UI
runs separately from two DevLang workers for authentication and enrollment. It
supports the local password form, Guest, GitHub device authorization, cancellation,
and local/GitHub user enrollment through the existing PAM/greetd backend. Password
requests use one-shot channel commands, never the replayed polling request.
`lib/greeter-service.dev` also serves the existing JSON backend contract; the native
wire format exposes only presentation fields, never OAuth tokens or flow state.

Build with `sh tools/build/native-login.sh`, then launch the explicit development
preview with `DEV_OS_ROOT="$PWD" DEVOS_LOGIN_PREVIEW=1 dist/native/login-preview`.
Without a greetd socket, actual authentication fails normally. Closing the preview
returns failure and never accepts a session. Power controls, GitHub avatar/brand
images, and visual parity still need porting/verification before the production
launcher switches away from GJS. The non-greetd Accounts welcome UI remains pending.

Tests: `d tests/greeter-native.test.dev` checks the worker protocols/redaction and
`d tests/login-native.test.dev` drives real GTK events against an isolated test
worker for enrollment, rejected passwords, GitHub cancellation/verification, Guest,
Enter submission, and closing without authentication. These tests do not call PAM,
GitHub, account creation tools, or power APIs.
`d tools/test/login-native-smoke.dev` additionally renders the preview with real,
read-only user inventory in a private Wayland session, checks its process maps for
the absence of MozJS, and verifies that SIGTERM cleans up without accepting a
session. Its screenshot is `build/screenshots/login-native-preview.png`.

The target is a DevLang implementation of the desktop, system components,
built-in apps and development tools. JavaScript/TypeScript app and extension
authoring remains supported through the existing npm `@dev-os/*` APIs, their
declarations, runtime loaders and compiler integrations. Third-party libraries
remain in their upstream languages. This migration is **not complete**.

## Background component status

`src/system/org.devos.background/scene.dev`, `design.dev`, `motion.dev`, and
`hacker.dev` implement all 24 original wallpaper styles in native DevLang/Cairo,
including seeded randomness, glyph masks, dither grain, and bounded scene caches.
`pace.dev` retains the original style IDs and animation intervals.
The native `react-devlang` renderer now provides `DrawingArea` for Cairo drawing.

Build the renderer candidate with `sh tools/build/native-background.sh`; launch
with `DEVOS_BACKGROUND_PREVIEW=1 dist/native/background-preview`. This explicit
preview supports all styles, Dark/Light, cached frames, HiDPI, solid colors, and
asynchronous local pictures with Cover/Contain/Stretch and a native file chooser.
Decoding is bounded to 4096 pixels per axis, honors embedded orientation, and
rejects stale load completions after cancellation or a new selection.

The candidate also has a layer-shell host that anchors to a selected monitor,
resizes with it, closes on monitor removal, and cleans up on SIGTERM/SIGINT.
The explicit diagnostic mode `DEVOS_BACKGROUND_DESKTOP_PREVIEW=1` strips preview
controls; `DEVOS_BACKGROUND_MONITOR` selects its zero-based output. The production
manifest now selects the native manager. Background Settings navigation opens a
separate native process. Widgets, menus, shell metadata, theme propagation and wallpaper
preferences are also available in the diagnostic modes below. The system
directory contains no JS/TS/TSX files. The SDK implementation remains isolated in
`packages/compat/background-legacy` for public JS/TS clients.
The wider shell and app migration remains incomplete. Public npm background
exports keep their original names and behavior. `tests/background-cleanup.test.dev`
prevents JS/TS/TSX files or stale SDK imports from returning to the system folder.

A native `system-background` manager now starts one UI per
GDK monitor, restarts a crashed UI independently, tracks monitor changes, and
stops owned UI processes on shutdown or manager death. Its two-output Wayland
smoke test verifies independent recovery, normal shutdown, parent-death cleanup,
absence of MozJS in UI processes, data-driver/interpreter cleanup after failure,
and a real session launch that survives a shell crash without duplicating the
manager. The session supervisor can discover native
system manifests and supervise their executable separately from shell restarts.
The production manifest selects this manager; diagnostic fixture sessions disable
automatic native systems with `DEVOS_NATIVE_SYSTEMS=0` and launch their own UI.

The native widget candidate provides clock, date, and note cards using the
SDK's native Overlay. `widget-service.dev` runs in a separate DevLang process;
it formats text and owns normalized positions and per-desktop edits. The UI owns
gestures and placement, retaining mapped cards during service updates and drags.
`DEV_OS_ROOT="$PWD" DEVOS_BACKGROUND_DESKTOP_PREVIEW=1
DEVOS_BACKGROUND_WIDGET_PREVIEW=1 dist/native/background-preview` enables this
explicit diagnostic mode (put the environment assignments on one command line).
Without an explicit preferences path, edits live only in the candidate worker.
Set `DEVOS_BACKGROUND_PREFERENCES` to an existing Background settings file (or a
new diagnostic file) to enable persistence in the existing `{version,enabled,values}`
format. The worker reloads it on reads and edits, atomically replaces it on writes,
preserves the envelope and unrelated values, and refuses damaged or newer files.
Native workers serialize read/modify/write with a sidecar lock; legacy JS writers
do not share that lock, so simultaneous legacy/native writes are not yet a fully
coordinated production path. The preview never selects the user's file implicitly.
The native board exposes `selectDesktop` for live desktop snapshots without
reconfiguring stored values, and displays service failures in a dismissible card.
It now supplies a native GTK right-click menu with the original standard items,
icons, enablement and custom-item separator. Menu data is service-owned; selection
is revalidated against current preferences, and produces a one-shot action plan.
Set `DEVOS_BACKGROUND_EXECUTE_ACTIONS=1` to execute selected actions: the separate
service starts `action-execute.dev` with `dist/native/libsupervisor.so`. Standard
actions use the existing shell D-Bus control interface, while custom actions use
literal argv and their home working directory. There is no GJS fallback when the
shell is unavailable. Without that explicit flag the diagnostic preview only
produces plans. `d tests/background-actions.test.dev` verifies real custom launches,
failure reporting and no polling replay, using temporary files only.
`native-theme.dev` now follows the shared native theme snapshot at
`$XDG_RUNTIME_DIR/devos-native-theme.css`, with the same generated family/mode
fallback as Task Manager. `DEVOS_BACKGROUND_THEME_FILE` selects an isolated
diagnostic snapshot. Widgets and native menus use the original system CSS;
desktop wallpaper rendering reads the live named base/accent colors, and its
frame cache invalidates on successful CSS revisions, including static styles.
The SDK retains the last valid provider and GTK mode when new CSS fails to load.
`d tests/background-theme-native.test.dev` verifies dark → light/family change →
invalid CSS → dark recovery, frame invalidation, stable mapped widgets and cleanup.
`appearance.dev` now derives the renderer's mode/style/fit/path/custom-color fields
from the same validated policy as the existing background. The service supplies
these as a stable `B` record, and `AppWithAppearance` applies them without rebuilding
the widget overlay. Supplying `DEVOS_BACKGROUND_PREFERENCES` in desktop preview
mode starts this path, even without the sample-widget flag. `native-preferences.dev`
debounces file notifications for 80 ms and requests a fresh service snapshot;
JSON decoding and preference decisions stay in the separate worker. Color-only
changes invalidate the frame cache, and image fit changes retain the decoded image.
`d tests/background-preferences-native.test.dev` verifies live solid/color-only,
Unicode picture path, contain/stretch, animated/static design changes, widget
identity and cleanup. Each update must arrive within three seconds, before the
normal eight-second poll, so this also checks the notification path.
`native-shell.dev` now starts the existing native Wayland window tracker and
forwards bounded batches of its raw events to the data worker. `src/services/window-state.dev`
publishes complete workspace batches, retains geometry across window updates,
and clears stale windows on disconnect. The worker derives per-output coverage
and battery-aware animation intervals; the renderer stops advancing animation
while covered and resumes on minimize, close, or workspace change. Theme changes
and preferences can still redraw a paused scene. Tracker reconnects after two
seconds, while viewport geometry is refreshed on the GTK thread. The optional
`DEVOS_BACKGROUND_TRACKER` override is for isolated diagnostics.
`d tests/background-shell-native.test.dev` drives 200 tracker events through the
real transport and worker, checks frozen/resumed frame revisions, workspace
ownership, tracker reconnect and child cleanup. `d tools/test/background-shell-smoke.dev`
uses the actual Wayland tracker in a private compositor and verifies separate UI,
data and tracker processes, no MozJS in any of them, and complete shutdown.
Native Background Settings is implemented in
`native-settings.devx`, backed by the separate `settings-service.dev` worker.
The worker owns saved/draft state, desktop ownership, field selection, custom
action editing and validation, Reset, and the final locked three-way Apply merge.
Picture validation uses the bounded GdkPixbuf codec in `libbackground-image.so`
inside that worker, before re-reading the latest preferences for commit.
The native UI preserves the system Settings stylesheet and provides the wallpaper
preview, design/mode/fit controls, picture chooser, color presets, widget toggles,
multiline note, context-menu preview/default toggles and structured custom editor.
Request acknowledgements protect optimistic text input from stale service replies.
Build with `sh tools/build/native-background-settings.sh`, then launch with
`DEV_OS_ROOT="$PWD" DEVOS_BACKGROUND_SETTINGS_PREVIEW=1
DEVOS_BACKGROUND_PREFERENCES=/path/to/org.devos.background.json
dist/native/background-settings-preview` (one command line). It never writes just
by opening; Apply uses the existing preference envelope. Production navigation
uses `settings.background` from both the shell and general Settings sidebar,
launching `dist/native/background-settings` with its own D-Bus singleton identity.
It uses the standard XDG Background preferences path without diagnostic overrides.
`d tests/background-settings.test.dev` verifies draft isolation, validation and
concurrent drag preservation. `d tests/background-settings-native.test.dev` drives
real GTK selectors, switches, rapid typing, multiline notes, custom actions,
Reset, rejected image Apply and successful image Apply through the actual worker.
`d tools/test/background-settings-smoke.dev` checks the Wayland window, separate
data/tracker children, no MozJS, no writes on opening and complete shutdown.
`d tools/test/background-settings-production-smoke.dev` exercises the real shell
route, native rendering, repeated opens, coexistence with general Settings,
no writes on open, and close/reopen.
`d tests/background-widget-service.test.dev` checks framing, Unicode, desktop
isolation, malformed requests and clamping. `d tools/test/background-widgets-smoke.dev`
drives a real Wayland pointer through 100 drag events and removal, verifies the
service persistence, live desktop switches, native right-click selection and plan
dispatch, zero drag unmaps, no MozJS in the UI process, and clean shutdown
with GLib criticals treated as fatal.

Widget desktop ownership, position parsing, picture geometry, command tokenization,
menu validation, and settings merge logic are implemented in `.dev` modules and
served by `service.dev`. The existing Settings frontend already uses the DevLang
worker for Apply validation and merge, retrying when preferences change during
the request. JS no longer owns that Apply merge decision.

Tests: `tests/background-domain.test.dev` checks data processing and its real
worker protocol; `tests/background-render-native.test.dev` compares native frames
against the legacy SDK reference at several timestamps and both themes;
`tests/background-ui-native.test.dev` exercises all 24 scenes on real GTK at
normal/HiDPI scales and checks widget cleanup. SDK lifecycle and JSX tests cover
the new native drawing callback boundary. The broader repository migration remains incomplete.
`tests/background-picture-native.test.dev` tests actual decoding, Unicode paths,
crop modes, stale requests, cancellation and resource cleanup. The isolated
two-monitor `tools/test/background-layer-smoke.dev` verifies output selection and
signal shutdown without MozJS; it never replaces the user's live desktop.

## Compatibility contract

`data/compat/npm-api.json` records the nine existing npm package names and their
export targets. `d tools/maintenance/migration-audit.dev` verifies those contracts
and writes `build/migration-audit.json`. New exports may be added; removing or
changing an existing export fails the check. CI runs the check and its regression
tests. `npm run migration:audit` is the npm entry point.

The report lists every owned TS/JS file, including SDK sources and JS/TS test
fixtures, separately from native system/app work. `npm run migration:check`
returns nonzero while production and tooling work remains. The inventory does
not treat the presence of a similarly named `.dev` file as a completed port.

The runtime target now also excludes GJS itself, including indirect launches from
DevLang programs. Run `npm run migration:no-gjs` for the stricter source audit.
It records runtime dependencies, GJS-specific GI bindings and unreadable source
files in `build/no-gjs-audit.json`, and exits nonzero while any remain. This gate
currently fails: the GUI shell/panel, built-in app hosts, services host and
login are not fully ported. The npm GI bindings also need a replacement
JS/TS provider before GJS can be removed while retaining JS/TS app authoring.
The existing desktop remains active during these incomplete UI ports.

## Implemented core ports

The compositor boot splash is now `src/system/splash.dev`, compiled to
`dist/native/boot-splash`. Geometry, dot-matrix text, spinner, milestone status,
fade and exit policy are DevLang; `splash-host.c` provides GTK/Cairo event/file
bindings. The 95 bitmap glyphs are generated directly from the framebuffer font
by `tools/build/splash-font.dev`. The session and greeter launch the native
binary. The splash recipe no longer installs the JS window or depends on GJS.
The native and previous reference renderer produced identical pixels at
1280x720 with a fixed animation time. Framebuffer splash code remains C.
Build: `sh tools/build/native-splash.sh` (included in native-app builds).

`src/system/command.dev` implements native command validation, session identity,
version/help, diagnostics and the existing D-Bus control protocol. `dev-os-shell`
uses it for commands to a running desktop and for bootstrap metadata/diagnostics.
The C host only handles D-Bus/GLib/library probing; command policy and checks are
DevLang. `@dev-os/runtime/doctor` is now a JS/TS adapter to those native checks.
The GUI bootstrap path in `dev-os-shell` is still GJS until the shell UI port is
complete; these native clients do not make the entire desktop GJS-free.

`bin/dev-os-session-root` validates and resolves the committed installed release
in DevLang. `dev-os-updated-session` no longer evaluates JavaScript to select a
release.

The normal `bin/dev-os-start` route starts `bin/dev-os-supervisor`, which executes
`src/system/supervisor.dev` with `devrun`. Session policy is in
`lib/session-supervisor.dev`; `native/supervisor-host.c` owns GLib subprocess
handles and Unix signal delivery. The supervisor waits for events/deadlines,
restarts crashed shells and service hosts, bounds crash loops, terminates whole
process groups on shutdown and validates installed-version handoffs. Configuration
and installed-version validation are implemented in `lib/config.dev` and
`lib/session-version.dev`. Build the host with
`sh tools/build/native-supervisor.sh` (also part of native-app builds).

The npm `@dev-os/supervisor` package keeps `runSupervisor(options)` and its
TypeScript interface. Its JS adapter forwards signals and runs the same DevLang
implementation without blocking the caller's GLib event dispatch. It does not
change the calling process's environment. The old `dist/supervisor.js` command
remains a compatibility entry to that adapter.

Theme generation now uses `tools/theme/generate-palette.dev` and
`lib/theme-palette.dev`, with declarative mappings in
`data/themes/palette-map.json`. The generator emits native JSON data to
`data/themes/palettes.json` and the existing npm TypeScript binding. Native CSS
generation reads the JSON directly. All four palette variants and syntax rules
were compared with the previous JS generator; all four native CSS files were
compared byte for byte with the previous data reader.

Task Manager and Display Care already have DevLang renderers/services. Background
has a shared DevLang data worker; its current renderer/widgets and Panel still
need native ports. The other built-in app UIs, the shell and several development
tools also still contain TS/JS. See the inventory and `devlang-app-migration.md`
for the remaining work. JS/TS runtime hosts remain available for third-party apps
and extensions throughout the migration.

## Development tools

Ported to DevLang (the `.mjs` originals are removed; each was compared with the original's output):

- `tools/maintenance/build-devos-icon.dev`: the four SVG variants are byte-identical to the committed files and the PNGs are
  pixel-identical for every size (the DevLang deflate encoder produces different compressed bytes). `tests/devos-icon.test.dev`.
- `tools/maintenance/build-app-icons.dev`: all `dev-os-*` icons are identical to the previous generator's output.
  Note that `dev-os-screenshot` is in `data/icons/fa/index.json`, so running it overwrites the hand-drawn Screenshot icon.
- `tools/theme/tokenize-css.dev`: output identical to the original on a 22 KB real stylesheet and a fixture with unicode,
  `alpha()`, `@ACCENT@` and selectors containing colons. `tests/tokenize-css.test.dev`.

Still TypeScript/JavaScript, with the reason:

- `tools/maintenance/import-material-icons.ts` bundles and runs the upstream Material Icon Theme's own TypeScript
  (`fileIcons.ts`, `folderIcons.ts`) to read its tables. That is upstream code, which stays in its language; the published
  JSON does not carry the same filters (pack selection, clone bases).
- `tools/store/import-registry.mjs` validates manifests with `packages/extensions/schema.ts` (npm SDK) and writes the
  TypeScript data module `src/apps/org.devos.appstore/registry-data.ts`; it moves with the App Store port.
- `tools/mcp/qemu-vm/server.dev` is the QEMU MCP server (ported from `server.ts`; tool schemas in `tools.json`, generated once from the Node server). `tools/list`, `initialize`, `ping`, errors and unknown methods match the Node server after key sorting; `vm_start`, `vm_status`, `vm_key`, `vm_type`, `vm_mouse`, `vm_serial_send`, `vm_qmp`, `vm_screenshot`, `vm_serial_log`, `vm_list` and `vm_stop` were exercised against the OE desktop image. `.mcp.json` now runs `d tools/mcp/qemu-vm/server.dev`. DevLang limits met: module-level `let` is not visible in functions, `execFileSync` output is capped at 8 MiB and string escapes such as `\/` and `\w` are invalid.

Findings in the DevLang runtime (0.5.5): `std/regex` reports byte offsets while `std/strings.substring` counts characters,
and has no lookahead; `std/compression.unzlib` fails on the 256 and 512 pixel PNG streams (valid for zlib); a `Vec` passed to a
function is not shared with the caller (return the new value); `Vec<u8>(1, 2, 3)` does not fill the vector.

The lane plan for the remaining application and system ports is in `devlang-port-lanes.md`.

## Checks

```sh
d tests/migration-compat.test.dev
d tests/no-gjs-audit.test.dev
d tests/splash-native.test.dev
d tools/test/splash-native-smoke.dev
d tests/shell-command-native.test.dev
d tests/session-model.test.dev
d tests/theme-palette-devlang.test.dev
sh tools/build/native-supervisor.sh
d tests/supervisor-native.test.dev
gjs -m dist/supervisor-test.js
gjs -m dist/version-request-test.js
d tools/test/background-runtime-smoke.dev
npm run core:pack
npm run supervisor:pack
```

The native supervisor and session smoke checks require Linux. GTK SDK tests use
an available display or Xvfb. npm packing creates local archives and does not
publish packages.

## Lane E status (panel, services, root glue, utils)

The first native panel JSX layout candidate now lives in
`org.devos.panel/native-layout-preview.devx`, backed by `panel-layout.dev` and
the pure `layout.dev` policy module. It preserves layout defaults, Desktop height
inheritance, bounds, rounding, pinned/date visibility and top/bottom selection.
The small C host provides GTK/layer-shell positioning, RGBA painting, monitor
removal and signal handling. A private two-output smoke checks real allocation,
live edge/height changes, X11 refusal, no MozJS, no GTK in the data interpreter,
and complete shutdown. Build with `sh tools/build/native-panel.sh` and launch
explicitly with `DEVOS_PANEL_PREVIEW=1 DEV_OS_ROOT="$PWD"
dist/native/panel-layout-preview` (one command line). This is layout diagnostics,
not the production panel: taskbar, tray, popups and interactions are pending.
The candidate now displays a live clock from `clock.dev` in its data worker.
GLib time formatting preserves local timezone/locale, Clock extension overrides,
seconds, Unicode and the existing invalid-format fallback. Wire encoding preserves
tabs and literal percent signs. A GTK polling cadence requests one-second updates;
the UI only decodes and displays the prepared text. `clock-host.c` is a GLib-only
ABI helper, keeping GTK out of the data interpreter. Tests cover deterministic UTC
formatting and live Clock preference reloads in the actual Wayland candidate.

Panel power-supply processing now lives in `org.devos.panel/power-model.dev`,
served by `src/services/panel-power.dev`. The GTK panel shares one read-only worker
across all monitors. Capacity fallback, battery selection, status, icons, labels,
tooltips and low/charging styles are prepared in DevLang. The compatibility IPC
adapter coalesces polling and recovers the worker; no synchronous power sysfs
reads remain in the panel UI. Fixtures cover qcom counters, peripheral/absent
batteries, adapter-only systems, invalid capacity and malformed requests.
The two-output smoke verifies a single worker without GTK/MozJS, shell response
while that worker is frozen, live presentation updates and worker recovery.
Network, Bluetooth, brightness and audio snapshots now run in a second shared
DevLang worker, `src/services/panel-devices.dev`. The service owns route selection,
radio parsing, backlight selection, PipeWire/PulseAudio fallback and presentation
labels. The UI sends only the GIO connectivity fact and displays the returned state.
Its coalesced channel carries read-only snapshots. Actions run through the separate
one-shot `src/services/panel-device-action.dev` worker. DevLang re-reads capabilities,
validates numeric values, clamps levels, chooses audio/radio backends and builds
literal command arguments. Each worker consumes one request and executes at most
one mutation. The compatibility IPC client never retries failed mutations and waits
for refreshed state before clearing busy. Unknown hardware produces no command;
command errors are preserved without exposing runtime stack locations in the UI.
Native action fixtures execute fake tools only and check clamping, backend argv,
fresh radio state, invalid requests, failure propagation and no repeated command.
The GJS transport test checks request preservation, errors, disposal and no replay.
Fixture tests cover malformed/missing audio, boosted volume, wired/wireless
routes, radio state, backlight priority, WSL and unavailable hardware. The smoke
also checks this worker's sharing, process maps, freeze isolation and recovery.
Panel context-menu preparation now runs in `org.devos.panel/menu-model.dev`,
served by a shared `panel-menu.dev` worker. It preserves the nine default actions,
custom filtering and separator placement; invalid custom entries preserve defaults.
`panel-menu-plan.dev` revalidates current preference values and creates literal
argv on activation, rejecting stale disabled actions. GTK renders prepared rows
and dispatches the validated plan. Source tests cover filtering, stale actions,
placeholders and literal shell metacharacters; GTK tests cover presentation and
cache notifications. Real Wayland pointer tests cover top/bottom placement,
settings routes, custom execution and the master switch. The JS menu API remains
for compatibility/Settings previews.
The production taskbar now takes its projection from `panel-taskbar.dev`, using
`org.devos.panel/taskbar.dev` for builtin identity, app grouping, desktop-ID/WM-class
lookup, title/icon choice, pinned entries, tooltips and active/minimized flags.
The GIO adapter only extracts catalog facts and transports snapshots; monitors
sharing a window source/pin setting share one worker. GTK renders these prepared
rows and retains the existing picker and window actions. GIcons are cached with
a fixed bound to avoid recreating them on every window-state update. Compatibility
clients retain the synchronous JS API. Source and GTK tests cover all builtins,
external titles, arrival order, pins, metadata precedence, live states/closure and
shared-worker disposal. The two-monitor smoke checks its maps, freeze isolation
and restart. The taskbar service now also accepts native tracker event batches
through `taskbar-session.dev`, retaining arrival order, geometry and catalog/pin
policy across polling and reconnects. Geometry-only records do not create ghost
tasks; closed windows and disconnects clear stale tasks. Its optional native wire
format escapes labels and prepares row flags/window IDs without JSON parsing on
GTK. The native preview now connects its own native tracker to this service through
bounded event batches. Its native taskbar renderer applies prepared rows, icons,
serialized GIcons, tooltips, running dots and active/minimized classes, preserving
button identity when a group's first window changes. Native GTK tests cover
selection callbacks, state/size updates and widget cleanup. The Wayland smoke opens
and closes a real native fixture window and checks that its task appears/disappears.
Pinned launch and single-window minimize/activate now work in the diagnostic
preview. DevLang selects from current task state, flushes pending tracker facts
before selection, and emits one-shot tracker commands; polling never repeats them.
Pinned commands use the native shell RPC transport. Stale selections surface an
error rather than acting on an old window. Multi-window groups open a native GTK
popover using prepared window rows and per-window activate/minimize/maximize/close
commands. Restore labels, disabled minimize buttons and removal follow live tracker
state. The native fixture checks the exact command sequence and widget cleanup.
Pinned pickers now include New window for Terminal and Files. The service validates
the current pin capability separately from window selection and uses native shell
RPC once per request. Tests cover successful/failed RPC without retry, polling,
hidden pins and conflicting actions. Pointer events now open nonmodal hover
previews after 400 ms, dismiss after a 250 ms leave delay, and promote right-click
pickers to modal. Child crossings do not dismiss the popup. Native tests cover
cancelled timers, movement into the popup, primary-click behavior and teardown.
The single-window popup retains its original text controls, including Restore.
The native clock popup also renders prepared weekday, full date and local time
with seconds/timezone, updates while open, and follows the show-date setting.
Time settings travels through a separate DevLang command worker and native shell
RPC. Its explicit acknowledgement is distinct from read-only pings; successful
and failed commands are never retried by polling. Native GTK tests check the
complete settings route, popup dismissal, live labels and widget cleanup.
External catalog collection now runs in the taskbar data process through a
GIO-only FFI helper. DevLang caches raw desktop facts until GAppInfoMonitor
changes, then recomputes names and serialized icons. Fixtures verify Unicode,
desktop-ID/WM-class matching, metadata edits, installation/removal and explicit
catalog fallback. The panel's other interactions remain pending.
Tray presentation now prepares network/audio icons, tooltips, radio labels,
slider availability and battery visibility/styles in DevLang. The existing
device worker supports an escaped native frame with power readings and optional
GIO connectivity. JSON clients are unchanged. A native indicator renderer is
covered by GTK fixtures. Its native Quick settings view now uses fresh device
actions, serialized pending/acknowledgement state, explicit failures and live
capability removal. Volume and brightness sliders, mute and Bluetooth use the
same executor as compatibility one-shot actions; Settings/Wi-Fi routes use native
shell RPC. Tests check exact command sequences without retry and disabled controls
after device removal. The candidate now mounts the tray, Quick settings and
Instant Full-Charge controls. Battery-care uses an independent DevLang worker
with the existing helper/polkit boundary, fresh capability/preference checks,
no replay, and rollback of the switch on denied authorization. Fixtures exercise
both helper compatibility on isolated supplies and native GTK lifecycle. The
Wayland smoke checks real pointer opening/dismissal, popup placement at either
panel edge, and shutdown of all six worker/transport children. Other panel
features still need migrating before production can switch.
Panel renderers now claim session-bus ownership per display/monitor. The native
preview refuses to stack over the legacy renderer or a second native instance.
Isolated preview sessions select `DEVOS_PANEL_RENDERER=native-preview` before
shell startup, which suppresses legacy panel surfaces. Smoke coverage checks
both conflict refusals and reacquisition after shutdown; its screenshots no
longer display overlapping panels.
The native GTK action fixture uses a fake tracker and checks exactly one minimize
and activate command through the complete renderer/service/transport path.
production panel rendering, transient UI state and other shell features remain JS.

Display Care now launches directly from its native system manifest through the
session supervisor. Its DevLang UI owns a native window tracker and sends bounded
event batches to its separate DevLang data service. Background and Display Care
share `src/services/window-state.dev` for window/workspace aggregation. Removed
the legacy renderer, `org.devos.displaycare/extension.ts`, and `native-process.ts`
JS lifecycle/metadata bridge. The Wayland smoke verifies two-output refresh,
dismissal, tracker-failure recovery, descendant cleanup, and independence from
shell restarts. Remaining lane E work still includes TypeScript:
the JS shell (`main.ts`, `app-host.ts`, `services/*-host.ts`, the panel) is the production runtime and
imports the remaining files. Display Care itself has no JS/TS/TSX/JSX remaining:
settings parsing, geometry rules and Pixel Shift planning are DevLang. The legacy
Panel's GTK adapter belongs to `org.devos.panel/panel-care.ts`; remaining Settings
consumers use the transport-only `@dev-os/compat/display-care` adapter. The old
shell-rule TS test was replaced by DevLang and its generated JS is cleaned on
build. `package-category.ts` remains shared with Settings and compatibility tests;
`login.tsx` is still launched by `bin/dev-os-start` and
`devos-greeter` until `dist/native/login-preview` is wired and verified on hardware.
A complete native panel, services host and shell entry remain the blocking work.
The panel has its layer-shell layout candidate, but still needs the taskbar,
D-Bus tray and feature-complete popups. Native service/logind bridges and a
DevLang shell entry also remain to be implemented.

The panel candidate now also includes a functional keyboard language selector,
Applications/Task View buttons, and desktop alerts. Keyboard choices are published
atomically from tracker batches and validated against current layouts before a
one-shot command. Shell messages travel over session D-Bus as raw text; the layout
worker owns bounded alert history, timestamps, escaping and clear actions. Native
GTK fixtures cover the complete message/worker/popup path and language switching.
Panel transparency, nine-position Pixel Shift and auto-hide settings are projected
by DevLang. The native host applies margins, keeps visible popups open, and restores
the panel from a two-pixel hot edge. Wayland checks cover bottom-edge reveal,
settings reload, duplicate ownership refusal and clean shutdown.

Native power controls and their separate DevLang worker now preserve confirmation,
desktop lock semantics, logind capability checks, and authorization-before-overlay
ordering for challenges. Already-authorized requests wait for a loading surface to
draw before execution; draw acknowledgements and polling never repeat a request.
Session-bus ownership coordinates requests across panel processes. The isolated
logind fixture verifies exact calls and denied authorization without touching real
power APIs. A two-output Wayland fixture covers cancellation, confirmation,
loading surfaces and cleanup. These controls still need mounting in the migrated
account menu. Production panel migration remains incomplete: account/menu/settings
parity and the native monitor manager must land before its JS files can be removed.
