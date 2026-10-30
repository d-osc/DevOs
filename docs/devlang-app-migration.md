# DevLang app migration

The repository-wide migration also preserves JS/TS npm app/extension APIs. See
`devlang-repository-migration.md` for the compatibility contract, core ports and
an inventory of remaining TS/JS work.

The migration proceeds one app at a time. `react-devlang` provides native GTK
function components, JSX (`.devx`), state, effects, keyed reconciliation, owned
UTF-8 strings and asynchronous service channels. Its converter and tests are
DevLang. A small C ABI bridge provides GTK/GIO integration.
App ports must preserve the existing theme, layout and controls. Reuse the shared
stylesheet and palettes, and compare the original and native UI before switching
an app's launch route.

## Task Manager: native window and service

- UI: `src/apps/org.devos.taskmanager/native.devx`.
- Entry: `src/apps/org.devos.taskmanager/native-main.devx`.
- Data worker: `src/services/taskmanager.dev`, using `lib/processes.dev`,
  `lib/task-metrics.dev` and `lib/task-view.dev`.
- Build: `sh tools/build/native-apps.sh`, producing `dist/native/taskmanager`.
- Launcher: `packages/shell/app-processes.ts` starts the native executable for
  `task-manager`, retaining the existing session-scoped D-Bus identity and
  singleton command endpoint. Missing native builds produce a build instruction.

The UI and worker are separate processes. The native UI renders service-prepared
rows and maintains search input, sort selection, selected process, pause and
confirmation state. The worker performs sampling, CPU/GPU/disk/network deltas,
formatting, filtering and sorting. GPU counters use Linux DRM fdinfo with client
deduplication and high watermarks. Network is sampled TCP payload, excluding UDP
and connections lost between samples. Unavailable or warming-up counters show —.

Process termination retains PID/start-time checks, pidfds, ownership checks and
protection of the service, UI and their ancestors. End/force-stop actions require
the in-app confirmation and are sent once. Repeated poll requests never replay a
stop action. `bin/dev-os-processes` remains a compatible CLI entry point to the
shared sampler.

The sort dropdown offers CPU, memory, GPU, GPU memory, swap, disk, TCP, name and PID.
At most 200 matching rows render. The native window restores the original summary
cards, two-line process columns, search field and DevOs header controls. It shares
the shell's original stylesheet and palette through a monitored runtime CSS file;
generated dark/light styles for both palette families provide a standalone fallback.
The Settings app's Task Manager
preferences page remains part of the JS Settings app until its migration.

The worker protocol accepts one JSON request per line. Responses are presentation
frames: tab-separated fields, ASCII record separator (30) between rows, and a
newline at the end. `S` contains summary strings, status and acknowledged
query/sort/pause values. `R` contains PID, start time, stoppability and formatted
columns. `E` contains an error. Display fields remove protocol separators.

## Settings: native hardware pages (candidate, not yet the production route)

- UI: `src/apps/org.devos.settings/native.devx` (entry `native-main.devx`, built to `dist/native/settings` by
  `tools/build/native-apps.sh`): sidebar plus Battery Care, Fan Profile, Connectivity (TaskFirst, WiFi SmartConnect), Touchpad (lock, Smart Gestures) Microphone (AI noise canceling) Keyboard (Fn key, backlight, sleep) Memory & Swap (draft rules in `swap-logic.dev`) Speaker (voice filter, booster, sound modes, custom equalizer) Language (layout list, shortcut, saved through `bin/dev-os-language` with JSON on stdin) and Display Care (OLED care, dimming, Splendid, target mode, edge brightness). The UI is split into `native.devx` (window, hooks), `native-kit.devx` (shared rows/parsers), `native-pages-hardware.devx` and `native-pages-system.devx` because the `.devx` converter refuses sources over 65,536 characters. `react-devlang` gained `ui.Scale` (horizontal slider, reports user changes once, 400 ms after the last movement) for the swappiness control; the rest of the audio/power/display sliders can now follow.
  Same CSS classes, texts and enable rules as the JS cards (`battery-care-view.tsx`, `fan-profile-view.tsx`,
  `connectivity-view.tsx`).
- Data worker: `src/apps/org.devos.settings/service.dev`, a separate DevLang process. It runs `bin/dev-os-<page>`
  (override directory with `DEVOS_SETTINGS_HELPERS`) with separate arguments, only for the pages/actions/arguments that
  `model.dev` validates, caches `get` per page (60 s battery, 30 s others, matching the old card timers) and answers each
  request line with one tab-separated frame (`S`, page, fields) or `E`.
- Tests: `d tests/settings-native.test.dev` (request validation, frame model, service against fake helpers incl. shell
  injection and failure paths, native window under Xvfb with the service). Not compared pixel-for-pixel with the JS
  card; not run on a real Wayland session or laptop (helpers report "unsupported" in WSL).
- The JS Settings window stays the production route: the native window has no other pages, no extension pages
  (Background, Panel, Clock, Task Manager preferences come from `context.settingsPages`), no `settings.<page>`
  command wiring and no user switcher. No Settings TS file was deleted. Blocking toolkit gaps for the rest: no
  slider (audio/speaker/mic volume), combo box with ids, radio group, tabs/stack, image/avatar, or a
  form that edits arbitrary extension fields. Network/Wi-Fi/Bluetooth need the D-Bus/NM workers ported first.

## Settings host: toolkit progress

- `react-devlang` gained `ui.Stack(options, active, children)` (GtkStack, widget kind 19): every page stays mounted and keeps
  its state; only the child at `active` is shown. Pages are named by position, so the active page is selected after
  children are attached. `<Stack active={n}>` is also a JSX tag (`tests/react-devlang/stack-jsx.devx`).
  Test: `tests/react-devlang/stack.dev` (in `d tests/react-devlang.test.dev`, 11/11 pass under WSL Ubuntu + Xvfb).
- The native Settings sidebar now has a "Desktop" group whose entries (Background, Panel) open their own native process through
  `rd_launch_shell` (`dev-os-shell settings.<name>`; the C side accepts only `settings.[a-z-]+`). 12/12 toolkit and 8/8 Settings tests pass.
- Not done: the page table is still a few hard-coded lists in `native.devx`, not manifest-driven. Still missing before the JS Settings host
  can be removed: a manifest-driven page table (sections, `context.settingsPages` equivalents, extension pages that open
  their own native process), the `Stack` JSX tag, radio group, tabs/notebook, list/tree, and the unported page views.
  No Settings TypeScript was deleted.

## Extension preferences service (native)

- `lib/ext-prefs.dev` reads and writes the existing ExtensionManager envelope `{version,enabled,values}` at
  `<config>/dev-os/extensions/<id>.json` with the rules of `packages/extensions/schema.ts`: all manifest fields present,
  unknown keys, wrong types, number min/max/integer and `#rrggbb` colors checked, system UI cannot be disabled. Ids are
  validated against path escapes. Writes take a sidecar lock, re-read, and replace the file atomically; an invalid or
  old-version file is reported as `error` and is never overwritten.
- `src/services/prefs.dev` is the worker: one JSON request per line (`get` / `set`), one JSON answer per line, manifests
  from the bundled `src/apps`, `src/system` and `src/extensions` only. `DEVOS_PREFERENCES_DIR` overrides the directory.
- Tests: `d tests/ext-prefs.test.dev` (4/4, WSL Ubuntu), including the real Theme manifest.
- Not done: version migrations (Theme v1 -> v2, Terminal v1 -> v2) stay in `packages/extensions/migrations.ts`; the native
  Theme and Icons pages that will use this service are not written yet, and the JS shell does not watch for changes made by it
  beyond the existing directory monitor.

## Settings: native Theme page (candidate)

- UI: `src/apps/org.devos.settings/native-theme-page.devx` (sidebar entry Theme under "Personalization"): Dark/Light previews
  drawn with Cairo from the real palettes, VS Code 2026 / GitHub color themes, Auto/Dark/Light, the Auto schedule with the
  same HH:MM rules, Reset and Apply, same CSS classes and texts as `settings-view.tsx`.
- Worker: `src/apps/org.devos.theme/service.dev` (palettes from `data/themes/palettes.json`, local time, validation) saves
  through `lib/ext-prefs.dev` into the same `org.devos.theme.json` the JS shell reads. `clock.dev` holds the std-free rules
  the UI uses; `model.dev` wraps them for the worker.
- Tests: `d tests/theme-native.test.dev` (clock rules, auto schedule incl. past midnight, worker incl. an old-version file that
  is reported and not overwritten, and the real GTK page choosing Dark and applying it under Xvfb). Settings 8/8 and toolkit
  12/12 still pass.
- Kept on purpose: `settings-view.tsx`, `options.ts` and `extension.ts` of the Theme app. The JS Settings window is still the
  production route and `extension.ts` is the engine that applies the theme in the JS shell; `tests/theme-settings.test.tsx`
  imports the page. Not verified: pixel comparison with the JS page, a real Wayland session, live re-theming of running
  apps after Apply (the JS shell's directory monitor does the reload), Theme v1 -> v2 migration (the page shows the error).

## Settings: native Theme icons page (candidate)

- UI: `src/apps/org.devos.settings/native-icons-page.devx` (sidebar entry "Theme icons", Personalization group): Font Awesome
  switch, six base-icon previews, 16 icon packs and the styles each really has, installed GTK icon themes with search and
  Refresh, the session-theme switch, the Material file/folder switch, Reset and Apply. Same classes and texts as `settings-view.tsx`.
- Worker: `src/apps/org.devos.icons/service.dev` with `fa.dev` (pack/style rules, glyph fallback chain, SVG output) and
  `rules.dev` (std-free, shared with the UI). It scans the GTK icon search paths for installed themes, resolves Material names
  as `material.ts` does and saves through `lib/ext-prefs.dev` into the `org.devos.icons.json` the JS shell reads.
- Toolkit: `ui.element(11, ...)` icons accept `<svg…` (drawn at 32 px) and `theme:NAME
ICON` (looked up in that icon theme);
  `rd_session_icon_theme()` gives the theme the session started with.
- Tests: `d tests/icons-native.test.dev` (5/5: pack rules incl. every pack/style file exists, SVG fallback, Material lookup,
  worker incl. refusals, real GTK page choosing Classic Thin and applying it). Theme 4/4, Settings 8/8, toolkit 12/12 and prefs 4/4 pass.
- Kept on purpose: the JS Icons `settings-view.tsx`, `extension.ts`, `fa-icons.ts`, `material.ts`, `themes.ts` (production Settings
  route, shell icon provider, Files/Editor imports, four compatibility tests). Not verified: how the SVG and themed previews look
  (no screenshot tool in the WSL image), real Wayland, pixel parity, live re-theming of running apps after Apply.

## Settings: native Updates page (candidate)

- UI: `src/apps/org.devos.settings/native-updates-page.devx` (sidebar entry "Updates"): status and Check for updates, the latest
  release (version, size, date, notes), swaylock installed/upstream, versions on this computer, the update source (repository,
  Save source, check-on-open and daily-check switches), plus Install update (second click confirms), Use previous version, Apply
  update file (typed absolute path, second click confirms) and a restart hint. No system-update, restart or file-chooser controls.
- Worker: `src/apps/org.devos.updates/service.dev` with `protocol.dev`: the read-only rules of `packages/updates` (stable semver
  and numeric comparison, repository names, platform, release/asset/digest/URL checks, swaylock release and version, installed
  history validated against each `release.json`) and the GitHub check over `std/http`. It stamps `last-check.json` like the JS
  updater and saves the source settings through `lib/ext-prefs.dev`. Test hooks: `DEVOS_UPDATES_ROOT`, `DEVOS_UPDATES_API`
  (only `http://127.0.0.1:<port>`), `DEVOS_PREFERENCES_DIR`.
- Tests: `d tests/updates-native.test.dev` (7/7: version/repository/release/swaylock/history rules mirroring `tests/updates.test.ts`,
  the worker against a fake local GitHub API incl. 404 and offline, and the real GTK page pressing Check under Xvfb). The other
  Settings suites still pass.
- Package engine, phase 2 (library only, no UI uses it yet): `manifest.dev` (manifest and patch validation incl. unsafe paths,
  duplicates, file/directory clashes, unknown post-install actions; manifest diff; SHA256SUMS; release asset discovery; archive
  listing checks for packages and patches) and `package.dev` (`sha256`, `verifyTree` = exactly the manifest incl. executable bits,
  Ed25519 `checkSignature` with the keys shipped in `data/update-keys`, `applyPatch` onto a copy of the installed tree with the
  base manifest hash, the target hash and the smuggling check, free/used space). Programs run with separate arguments. Test:
  `d tests/updates-package.test.dev` (6/6: tampered, extra, missing, wrong-mode and symlink files, wrong/missing signature,
  patches for another base, smuggling a file, keeping a removed file, no manifest; the base tree is unchanged and no half-built
  tree is left). Not ported: `createPatch` (release tooling), `buildManifest`, and everything in `service.ts` that downloads,
  installs, rolls back, uses an update file, runs the system helper or restarts. Still TypeScript and still the production path.
- Install engine, phase 3 (called by the worker actions `install`, `installFile` and `rollback`): `install.dev` ports `install`, `installFile`, `rollback`,
  `activate`, `prune`, the install lock and the leftover cleanup of `service.ts` as plain functions over a `Ctx` returning an
  `Outcome`. The commit point is one atomic replacement of `history.json`; the `current` link follows. Downloads use curl in the
  background (HTTPS to github.com only, redirects stay on HTTPS, size capped, size checked) because one subprocess call is limited to
  five minutes. Two sources must agree (API digest and SHA256SUMS, Ed25519-signed when a key ships), a corrupt patch falls back to the
  full package, a kept previous release is reused without downloading, and a failed install leaves no staging, lock or half-built tree.
  Test: `d tests/updates-install.test.dev` (7/7: install, repeat, bad paths, Live USB, disk space, minCompatible, tampered or
  incomplete packages, patch + rollback + roll forward + pruning, stale lock and leftovers, damaged history, signed-only mode, loopback
  downloads with a wrong digest, a corrupt patch and a foreign host). Not ported: system updates (`dev-os-system-*`, the privileged
  helper, restart) and `useInstalled` (the shell restart). Not verified: a real GitHub download, a Live USB, an installed system, and
  the TypeScript tests (`tests/updates*.ts`, which need GJS) were not run. The JS Settings page and `service.ts` stay the production install path.
- Phase 3b, wiring: the worker re-fetches the latest release itself for `install` (the page sends no URL), builds the install context
  from `DEV_OS_ROOT` (keys in `data/update-keys`), refuses on a Live USB and answers with the usual frame (+ trust, patched). The page shows
  "Working…" while a request runs; there is no download progress bar. Test: `d tests/updates-install.test.dev` (9/9; adds the worker
  installing two files, rolling back and forward, refusing a relative path, explaining a missing connection and unknown actions, and the real
  GTK page installing a file after two clicks). Not covered end to end: `install` from real GitHub through the worker (the engine test
  covers downloads over loopback; the worker's GitHub URLs must be https://github.com/…), the restart ("Use this version") and system updates.
  Since this window can now change what the next session starts from, it is still not the production Settings route.
- Phase 4, system updates (kernel, initramfs, bootloader stub, firmware, system files): the privileged helper
  (`bin/dev-os-system-update` -> `native/devos-system-update`, polkit, shell) is not TypeScript and stays as it is; it re-checks every
  file itself. The DevLang side is the client: `system.dev` (bundle description rules incl. the ESP/root path allow-lists that keep the
  helper, its polkit rules and units out of reach, the helper's line list, offer, status), `helper.dev` (runs the helper in the
  background so approval and long copies are not cut off at five minutes; maps a denied approval, silence and timeouts to clear
  messages) and the end of `install.dev` (`systemState`, `checkSystem`, `installSystem` with the same two-source digest check and
  Ed25519 rule as releases, `installFile` for `dev-os-system-*` files, cancel/rollback, restart). Worker actions: `installSystem`,
  `cancelSystem`, `rollbackSystem`, `restart`; frame fields 25-38. The page has the System card (offer, safe-boot note, install with a
  second click, pending, cancel/restore) and a restart card (second click). Tests: `d tests/updates-system.test.dev` (5/5, using the
  real helper against a fake root and ESP: bundle rules, denied approval, apply, pending, second apply refused, cancel restores the system
  files, damaged bundle refused, offer from a loopback release with a wrong description/bundle digest refused, Live USB refused, restart
  command, and the real GTK page installing a bundle). `tests/updates-native.test.dev` is 8/8, install 9/9.
  Not ported: building bundles (`make-system-bundle`, release tooling). Not verified: a real `pkexec` approval, UEFI `efibootmgr`
  boot-next mode (the test rig uses the helper's no-UEFI in-place mode, where cancel restores system files but the ESP keeps the new
  image with the old one saved as `.prev`), a real restart, Live USB. The restart action runs `systemctl reboot` after two clicks.
- Phase 5, switching to the installed version (`useInstalled`): `install.dev` `useInstalled` repeats the checks of
  `requestSessionVersion` (the request file must be `$XDG_RUNTIME_DIR/dev-os-version-<hex-or-dash>.json` announced in
  `DEV_OS_VERSION_REQUEST`; the selected version is still the one shown; its session manager and `bin/dev-os-start` exist; its own
  `dev-os-shell --version` equals its release.json; `dev-os-shell doctor` passes; the selection did not change meanwhile), writes the request
  atomically and then runs `dev-os-shell session.restart` of the running install. Worker action `useInstalled`; the page's "Ready to use Dev OS
  X" card has Restart shell now (second click confirms) and Restart later. Tests: `updates-install.test.dev` 10/10 (no session manager,
  bad request names and paths, nothing installed, failing doctor, missing supervisor, failing restart, a runtime that reports another
  version, and the good path) and the worker case in `updates-native.test.dev` 8/8. Not verified: a real session manager picking the request up.
  With this the native Updates page covers everything the JS page did except the file chooser (Browse…), the "View swaylock releases" link,
  a download progress bar and the rate-limit reset time. `packages/updates` and the JS page are still the production path and were not deleted.

## Settings: native Apps & extensions page (generic manifest form, candidate)

- UI: `src/apps/org.devos.settings/native-extensions-page.devx` (sidebar entry "Apps & extensions"): a search box and the extensions grouped
  SYSTEM / SYSTEM APPS / EXTENSIONS, and for the selected one the form its manifest describes (string, color, number with its allowed range,
  boolean), the Enabled switch for non-system extensions, Reset and Apply. The draft stays on the page until Apply.
- Worker: `src/apps/org.devos.settings/extensions.dev` (`list`, `form`, `save`) reads the manifests of `src/system`, `src/apps`,
  `src/extensions` and the user's extension directory (a user package cannot reuse a bundled id or claim system UI) and saves through
  `lib/ext-prefs.dev`, so values are validated against the manifest and a damaged or old-version file is reported and never overwritten.
  Extensions that have their own native page (Theme, Theme icons, Updates, Background, Panel) are not listed; neither are those with no settings.
- Tests: `d tests/extensions-native.test.dev` (4/4: grouping, hiding, hostile user packages, sorting; the form frame; saving with wrong
  type/range/unknown key/disabling a system app/editing an extension with its own page/bad ids/damaged file; and the real GTK page opening
  the first app and saving an edit). Other Settings suites still pass.
- Gaps against the JS editor: the JS list also shows extensions with no settings and user-package diagnostics; there is no "open the
  settings file in the Editor" button, no colour swatch, and the pages with a richer custom JS view (Files, Terminal, Launcher, Camera,
  Task Manager, Disk Manager, App Store, Microphone input) are only covered by their manifest fields here.
  The sidebar of the page is inside the page, not part of the main Settings sidebar yet.

## Settings: native Desktop page (candidate)

- UI: `src/apps/org.devos.settings/native-desktop-page.devx` (sidebar entry "Desktop"): desktop name, panel height (32-96), clock format and
  the terminal / external file manager / lock / autostart commands as JSON text, same titles and hints as the JS "Desktop" page, with
  Reset and Apply. A damaged `config.json` is shown as a banner with the defaults; Apply replaces it with the validated form.
- Worker: `desktop-config.dev` validates with `lib/config.dev` (the DevLang copy of `@dev-os/config`), writes
  `<config>/dev-os/config.json` atomically (dropping the legacy colour keys like `saveConfig`), and then runs `dev-os-shell reload`; a
  failed reload is reported ("Saved, but the running desktop could not reload") and the file stays saved. Runtime-added error prefixes
  are stripped from messages.
- Tests: `d tests/desktop-native.test.dev` (4/4: defaults, save and read back, eleven kinds of invalid input with their messages and an
  unchanged file, damaged and legacy files, failed reload, and the real GTK page saving a rename). Other Settings suites still pass.
- Not done: the JS page also refreshes the open Settings window and uses the shell's own `reloadConfig` return value; here the shell is
  reloaded through its command line. Not verified against a running shell.

## Settings: native System pages (candidate)

- Pages (sidebar group "System"): About, Storage, Power & battery, Date & time, Mouse, Keyboard input
  (`src/apps/org.devos.settings/native-system-pages.devx`). They show the same information and controls as the JS pages: device identity,
  processor and memory, firmware and operating system rows with the WSL note; disk cards with usage bars; batteries (charge, health,
  cycles, time left), the three power modes with Apply, or the Windows/unavailable notes; time zone search and choice, automatic time,
  manual date and time, the Windows settings button; pointer speed, left-handed and natural scrolling; key repeat on/off, delay and rate.
- Worker: `system-pages.dev` runs the existing DevLang helpers `bin/dev-os-system`, `bin/dev-os-time` and `bin/dev-os-input-settings` with
  separate arguments (they keep their own validation and polkit prompts), checks the request shapes (power profile, input kind and
  operation) and answers with tab-separated frames. `DEVOS_SETTINGS_HELPERS` redirects the helper directory for tests.
- Tests: `d tests/system-native.test.dev` (6/6: the frames, payload mapping and refusals, helper failures, the real helpers, and the real
  GTK pages for About, Storage, power mode switch, time zone change and input reset against fake helpers). Other Settings suites pass.
  The first run found a real bug in these pages (a page that waited on a ref for "loaded" never re-rendered when the first reply changed
  nothing else); they now render as soon as a frame or an error exists.
- Not in these pages: Display and Sound (need monitor and audio widgets), the Windows "Open ... settings" buttons other than time, a live
  clock preview (the time shown is read when the page loads or after a change), the keyboard hotkey editor of the JS Keyboard page,
  and the "Open Files" shortcut on Storage. Not verified: writes to a real `timedatectl`/polkit, a real touchpad/mouse, pixel parity.

## Settings: native Accounts page (candidate)

- UI: `src/apps/org.devos.settings/native-accounts-page.devx` (sidebar entry "Accounts"): current profile with the GITHUB LINKED / LOCAL
  ACCOUNT badge, the GitHub sign-in card (Connect / Reconnect / Sign in with GitHub, the device code with "Open GitHub in browser" and
  Cancel while waiting, Unlink, Sign out online), the people on this device with YOU and Switch user, and the local-password note.
  The enable rule matches the JS page (needs a client ID; not for the shared `devos`, `root` or `devos-greeter` user when user management exists).
- Worker: `accounts-page.dev` runs `bin/dev-os-accounts` (the existing DevLang helper that owns the device flow, the identity file and the
  privileged bridge) and answers with frames. `begin` asks for a GitHub link to the OS user when user management is available; `begin`, `poll`
  and `cancel` answers are laid over the full account state so the profile and user list stay; the page polls while a code is shown and stops on
  approval, expiry, error or cancel. `switch` is only accepted for a user listed on this device, never the current user or `devos`, and runs
  `dev-os-shell switch-user <name>`. `create-user` is not forwarded.
- Toolkit: `rd_open_device_page()` opens exactly `https://github.com/login/device` in the default browser and nothing else.
- Tests: `d tests/accounts-native.test.dev` (5/5, all against a fake helper except one read-only `get` of the real one: frames, the sign-in
  flow, user switching rules and refusals, helper failures, and the real GTK page switching user). Other Settings suites pass. The GTK test
  found that a page waiting for an answer identical to the previous one never re-rendered; the shared `link` now counts replies.
- Not done: **New user** (the JS wizard sets a password through the greeter's PAM bridge; it belongs with the native login enrollment, not
  here), the GitHub avatar picture (an icon is shown), and the Linux-user login variant of the same view (`onContinue`, used by the login
  screen). Not verified: a real GitHub device flow, the privileged link/unlink bridge, a real user switch.

## Settings: native Network pages, first group (candidate)

- Pages (sidebar group "Network & Internet"; Connectivity was already native): VPN, Mobile hotspot, Airplane mode, Advanced network settings
  (`src/apps/org.devos.settings/native-network-pages.devx`). VPN: profiles with Connect… (credentials form; user name disabled for WireGuard)
  / Disconnect, Remove… with confirmation, and Add a VPN (WireGuard or OpenVPN, configuration typed as a full path). Hotspot: the running hotspot
  with Stop and the name/password shown until you leave the page, or the adapter/name/password form with a suggested random password and the
  JS page's reasons when the hardware cannot host one. Airplane mode: the switch and the radios. Advanced: connectivity status with Check now
  and one card per adapter (wired and Wi-Fi first) with address, driver, MTU, IPv4/IPv6, gateways, DNS, and Connect…/Disconnect… with confirmation.
  The "Network & Internet" overview page is not a page of its own: the sidebar group replaces its list of links.
- Worker: `network-pages.dev` runs `bin/dev-os-network-settings` (NetworkManager over D-Bus/libnm, `nmcli`, `pkexec` for rfkill) after checking each
  request (types, absolute file path, no control characters, SSID 1-32, password 8-63 printable ASCII) and returns frames without secrets.
- Toolkit: no new widget was needed. `native.devx` now picks component pages through a flat `componentPage` function because a long
  else-if chain hit the converter's parser nesting limit (32 frames).
- Tests: `d tests/network-native.test.dev` (6/6: the frame, exact payloads, 19 kinds of refused input that never reach the helper, helper
  failures and the real helper's answer without NetworkManager, and the real GTK pages for VPN connect, hotspot start, airplane and advanced).
  All other Settings suites still pass. **Not verified:** any real NetworkManager, VPN, hotspot or rfkill operation (this machine has none).
- Not done in this group: a file chooser for VPN import (a path is typed), Wi-Fi, Proxy, Printers and Bluetooth.

## Settings: native Printers page (candidate)

- UI: `src/apps/org.devos.settings/native-printers-page.devx` (sidebar group "Devices", entry "Printers & devices"): the CUPS queues with the
  Default marker, Set default, Remove… with confirmation, the helper's status message (for example "The CUPS printing service is not
  running."), Add a network printer (name and ipp/ipps address, enabled only when valid and CUPS is available) and Refresh. Same texts as the JS page.
- Worker: `printers-page.dev` runs `bin/dev-os-printers` (lpstat, lpadmin, lpoptions) after repeating its checks: queue names of 1-63 letters,
  digits, hyphens and underscores not starting with a hyphen; addresses that start with ipp:// or ipps:// have a host and no credentials,
  spaces, backslash or fragment. The helper still checks again and needs the CUPS administration permissions itself.
- Tests: `d tests/printers-native.test.dev` (4/4: the frame, exact payloads, 14 refused inputs that never reach the helper, helper failures and the
  real helper without CUPS, and the real GTK page adding a printer). Other Settings suites still pass. **Not verified** against a running CUPS or
  a real printer.
- Not done: print jobs (the helper reports none), USB/local printer discovery, and the other "devices" items of the JS Devices page.

## Settings: native Wi-Fi page (candidate)

- UI: `src/apps/org.devos.settings/native-wifi-page.devx` (first entry of "Network & Internet"): the status line, Refresh, the Wi-Fi radio switch
  (Linux), the current network card with signal and security and Disconnect, the "Wi-Fi is off" state, the password form (WPA2 at least 8 characters,
  WPA3 at least 1, show/hide, Cancel/Connect), Nearby networks with search and Connect / Set up, and in WSL the "Open Windows Wi-Fi settings" card.
- Worker: `wifi-page.dev`. On Linux it runs `bin/dev-os-network-linux`; inside WSL it builds the same encoded PowerShell command as the JS page
  (script + base64 request, UTF-16LE through `iconv`/`base64` with the data on stdin) and runs the host's `powershell.exe` for `bin/dev-os-wifi.ps1`;
  there only saved profiles can be joined and the request carries no SSID or password. It validates requests (interface UUID, SSID up to 32 bytes, no
  control characters, password up to 128), normalizes the scan like `normalizeWifiNetworks` (invalid data is an error, hidden networks dropped, duplicates
  merged, signal 0-100, connected then strongest first), scans again after connect, disconnect and radio changes, and never returns a password.
  A refused Windows scan adds the location-privacy hint.
- Tests: `d tests/wifi-native.test.dev` (6/6: the scan frame and malformed data, exact payloads and the follow-up scan, 11 refused requests that never reach
  the helper, the WSL command (arguments, decoded script and request, no password sent, access denied), **a real Windows PowerShell scan from WSL on this
  machine**, and the real GTK page joining a saved network and a new one with a typed password). Other Settings suites pass.
- **Not verified:** NetworkManager connect, disconnect and radio changes on real Linux hardware, and a Windows connect to a saved profile.
- Not done: hidden-network entry and enterprise (802.1X) networks (the helper reports them as not connectable, like the JS page).

## Disk Manager: native window and service

- UI: `src/apps/org.devos.diskmanager/native.devx` (entry `native-main.devx`): device list, capacity map drawn with Cairo
  `DrawingArea`, partition cards, WSL notice, Refresh, same CSS classes as the JS window.
- Worker: `service.dev` + `model.dev` run `bin/dev-os-disks` (already DevLang) and answer one JSON request per line
  with a presentation frame (`S` summary, `D` disks, `P` partitions; tab fields, ASCII 30 between records, `E` errors).
  `DEV_OS_DISKS_HELPER` overrides the helper for tests.
- Build: `sh tools/build/native-apps.sh` -> `dist/native/diskmanager`. Launcher: `packages/shell/app-processes.ts` now has a
  `NATIVE_APPS` map (Task Manager, Disk Manager); `disk-manager` (shell command, launcher, Settings "Open Disk Manager")
  starts the native executable with the usual session-scoped D-Bus identity.
- `rd_app_header_for` in `packages/react-devlang/native/theme.c` generalises the app header (window name, icon);
  `rd_app_header` keeps the Task Manager defaults.
- Verified: `d tests/diskmanager-native.test.dev` (formatting, frame, service protocol and failures, real GTK under
  Xvfb + D-Bus with a fixture helper). Not verified: visual parity screenshot, real laptop/Wayland, real `lsblk` data.
- `extension.json` uses `"native": "diskmanager"` instead of a JS `entry`: the manifest schema now accepts a `native`
  executable name for **system** UI (never for store packages); `loadSystemExtensions` gives it a no-op stub and
  `tools/build/build.ts` does not bundle it. `extension.tsx` is deleted. Still TypeScript: `settings.tsx` (imported by
  the JS Settings app and `tests/disk-manager.test.tsx`), `disks.ts`/`disks.backend.ts` (used by that settings page).

## Installer: native wizard and worker

- UI: `src/apps/org.devos.installer/native.devx` (welcome, disk choice, account, review with typed disk path, progress,
  done/failed); same classes and texts as the JS wizard; the window cannot be closed while a disk is being written
  (`rd_block_close`). Worker: `service.dev` + `model.dev`: lists disks with `bin/dev-os-install disks --json`, validates the
  request again, runs `bin/dev-os-install run ... --password-stdin` (password only on its stdin) and follows its `STEP/DONE/ERROR`
  output through a private file because DevLang has no streaming child stdio. Manifest is `native: installer`; `installer.ts`,
  `installer.backend.ts`, `extension.tsx`, `tests/installer-ui.test.tsx` and the app-service registry entry are deleted.
- Verified: `d tests/installer-native.test.dev` (rules, event parsing, worker protocol with a fixture helper that never writes
  a disk, real GTK wizard driven through every page under Xvfb). Not verified: real disk installation with the native UI
  (the helper itself keeps `tests/installer*.test.py`), visual comparison, Live USB hardware.

## Remaining work

Files, Terminal, Editor, Camera, Microphone, Browser, App Store, Screenshot and
Settings still run through the JS app host (Disk Manager and Installer are native).
Blockers found while porting them: react-devlang has no popover/menu, list/tree
view, notebook/tabs, drag-and-drop, VTE terminal, WebKit, source-editor or video
widgets; Theme, Icons, Updates and Launcher are not windows but code running inside
the JS shell/Settings process (CSS provider, settings pages over the SDK package
`packages/updates`, the overlay), so they move together with the shell and Settings
ports; DevLang has no streaming child-process stdio (the Installer worker follows a
progress file instead). Launcher,
Updates and the theme/icon foundations also still use JS. Panel, background and
display care remain system components. Display care now uses a native DevLang UI
and a separate DevLang service. Background uses a shared DevLang data model for
appearance, monitor coverage and battery-aware animation timing; its renderer,
widgets and menus still use the original JS UI. Panel is still JS. See
`src/system/README.md` for the remaining system migration scope.

Their native ports need the corresponding GTK controls and integrations before
switching launch routes. Existing JS implementations remain as compatibility and
regression references during migration; the normal Task Manager launch route uses
the native window and DevLang worker.

Linux builds run the native-app builder automatically. `dev.ps1 build` and Windows
runtime staging run the GTK/native compilation step through WSL. Runtime staging, release
archives and the OE install recipe include `src/services` and shared DevLang
modules. Generated compiler caches and intermediate objects are excluded from
release payloads. A fresh desktop runtime is needed to use updated launch routes.

## Validation

```sh
sh tools/build/native-apps.sh
d tests/taskmanager-native.test.dev
d tests/react-devlang-jsx.test.dev
d tests/react-devlang.test.dev
d tools/test/react-devlang-smoke.dev --
python3 tests/processes.test.py
python3 tests/oe-shell-packaging.test.py
python3 tests/release-package.test.py
```

The Python commands are existing compatibility/packaging regression harnesses;
the new app, service, JSX toolchain and native app tests use DevLang.

## Settings: native Proxy page (candidate)

`src/apps/org.devos.settings/native-proxy-page.devx` is the native Proxy page (sidebar entry after Airplane mode). It talks to the worker `proxy-page.dev`, which reads and writes `org.gnome.system.proxy` with the `gsettings` program (separate arguments, no shell) and repeats the JS page's validation: modes, PAC address, host characters, ports 1–65535, at most 100 bypass entries. Saving writes every key and restores the previous values if one write fails; keys locked by an administrator are refused.

Deliberate differences from the JS page: the saved password is never sent back to the UI (the field stays empty and an empty field keeps the saved password), and ports are numeric entries instead of spin buttons.

Verified: `tests/proxy-native.test.dev` (4/4) against an isolated keyfile GSettings backend, plus a real GTK smoke under xvfb. Not verified: a real system dconf/GNOME session, administrator-locked keys, whether apps pick up the change, and pixel parity with the JS page. The JS Settings route stays the production route.

## Settings: native Bluetooth page, read and control (candidate)

`src/apps/org.devos.settings/native-bluetooth-page.devx` is the first half of the Bluetooth page (first entry of the Devices group, before Printers). The worker `bluetooth-page.dev` runs the existing DevLang helper `bin/dev-os-devices-linux` (BlueZ over D-Bus) with one JSON request on stdin, checks that every adapter and device path is a `/org/bluez/hci…` path, and turns the state into a tab-separated frame. The page lists adapters (power switch), paired and nearby devices (Connect, Disconnect, Forget with a confirm step), a Scan nearby button (the helper scans for about 8 seconds) and the USB and input devices.

Not ported: pairing a new device. It needs a BlueZ agent (`org.bluez.Agent1`) exported on the session bus, which needs a C bridge in `gtk.c`; the Pair… button is shown disabled and the page says so. The JS page keeps pairing, so `bluetooth-agent.ts`, `bluetooth-discovery.ts` and the other Bluetooth TS files stay.

Verified: `tests/bluetooth-native.test.dev` (4/4) with a fake `dev-os-devices-linux` (frames, forwarded payloads, rejected requests, helper errors, malformed answers) and a real GTK smoke that connects a paired device. Not verified: real BlueZ hardware, a real scan, WSL passthrough, pixel parity. The JS Settings route stays the production route.

## Launcher: data rules in DevLang (first step)

`src/apps/org.devos.launcher/model.dev` holds the pure rules of the launcher: option clamping (`options.ts`), the workspace app list and app view (`customization.ts`), which entries may offer Uninstall (`userPackageCommand` of `uninstall.ts`: only `dev-<command>.desktop` files in the user directory, regular files and not symlinks, whose Exec is `… --root <store> run <command>` for the same command; `dev-os-*` base apps never qualify) and the lines of the Info menu item. `tests/launcher-model.test.dev` (4/4) mirrors the cases of `tests/launcher-uninstall.test.ts`.

Not ported: the launcher window itself (`view.tsx`, `task-view.tsx`, `snap-view.tsx`, `snap-sashes.ts`, `overlay-motion.ts`, `index.ts`, `settings-view.tsx`), which depends on the shell overlay and the window tracker and needs a real Wayland session to verify. No TS file was deleted, because the JS launcher is still the production route and `tests/launcher-*.test.ts` import the TS modules.

## Files: data rules in DevLang (first step)

`src/apps/org.devos.files/model.dev` holds the GTK-free rules of the Files app: file name validation, file kinds and tags (`presentation.ts`), home-relative paths, path resolution (`~`, `.`, `..`), the browsing history (back, forward, a new visit drops the forward part), a folder listing (one `find` call; folders first, then names in natural order with numbers compared as numbers, case ignored and punctuation first, as `Intl.Collator` does), hidden-file filtering, create folder and rename (neither overwrites an existing name). `tests/files-model.test.dev` (6/6) covers them with real temporary folders.

Not ported: the window (`view.tsx`, `search-view.tsx`, `index.ts`, menus, settings), the search backend, the package-open routing (it imports the App Store TS), and the date label of `presentation.ts`. No TS file was deleted: the JS Files app is still the production route. Locale-specific collation (accents, non-Latin scripts) is not reproduced; names compare by lowercase bytes.

## App Store: package rules in DevLang (first step)

`src/apps/org.devos.appstore/package-rules.dev` holds the text-only rules of `package-file.ts`: which paths are packages (`.dpk`, `.dpkx`, `.deb`, `.rpm`, `.tar.gz`, case-insensitive, never a bare suffix), the DevOsPM package name mapping, the archive path check (the same reasons as `manager::safe_path`), path normalisation, when a tar entry makes a `.tar.gz` installable, and Debian control parsing. `tests/appstore-package-rules.test.dev` (5/5) covers them.

Not ported: reading the files themselves (tar header walking, gzip, `.deb` ar members, `.rpm` header tables, `inspectPackage`), the registry data and the App Store window. The binary readers need byte-level access that is better done with the existing updates package code or a helper than by a line-for-line copy, and that part cannot be verified here against real `.deb` and `.rpm` files. No TS file was deleted: `package-open.ts` of Files and the App Store UI import `package-file.ts`, and `tests/package-install*.ts*` cover it.

## Settings: shell commands reach the native window

A native react-devlang app used to answer only its exact command and just raise its window. `rd_accept` (C bridge) and `ui.onCommand(context, prefixes, handler)` (toolkit) now let an app also answer commands with given prefixes and receive the whole command line (arguments separated by ASCII 31) as event kind 7. Native Settings registers `settings.,session.`: `settings.<page>` opens that page, `settings.network` opens the first network page (Wi-Fi), `session.switch-user` opens Accounts, `settings.background` and `settings.panel` open their own windows, and anything else (for example `launcher.show`) is still refused. Other native apps register no prefix and behave as before.

Verified: `tests/settings-command.test.dev` (3/3) sends the commands over a real session bus to a running window under Xvfb. Not covered: the user-switch dialog that the JS `session.switch-user` showed (native Accounts has its own switch control), and the shell side, which still launches the JS Settings because `settings` is not yet in `NATIVE_APPS`. Features native Settings still lacks (Bluetooth pairing, Display and Sound pages, the new-user wizard, per-app pages) mean the route should not be switched yet.

## Settings: native Sound page (candidate)

`src/apps/org.devos.settings/native-sound-page.devx` is the native Sound page (Devices group, after Bluetooth). The worker `sound-page.dev` runs `pactl` with separate arguments and mirrors `audio.backend.ts`: sinks, sources (monitors left out) and playing applications, the volume as the mean of the channels, volume 0–100, mute, default device and moving an application to another output. Requests are checked (kind, non-negative integer ids, device names without control characters and not starting with `-`), and every change is followed by a fresh read. The page has a volume slider and a mute button for the default output, the default input and every application, plus a device list for the default devices and an output list for each application.

Differences from the JS page: the page reads when it opens, after each change and on Refresh, but does not poll every 3 seconds, and the "inputOnly" variant used by the Microphone page is not part of it. Verified: `tests/sound-native.test.dev` (4/4) with a stand-in `pactl` and a real GTK smoke that mutes the default output. Not verified: a real PulseAudio or PipeWire server, hot-plugged devices, pixel parity. The JS Sound page stays the production route.

## Settings: native Display page (candidate)

`src/apps/org.devos.settings/native-display-page.devx` is the native Displays page (Devices group, after Sound). The worker `display-page.dev` runs `wlr-randr` with separate arguments and keeps the safety design of `displays.backend.ts`: a change is first checked against the current outputs (connected output, one of its own mode ids, scale 0.5–4, a known rotation, integer positions within ±32768), dry-run, and only then applied. The layout to go back to is written to a marker file in the runtime folder (one argument per line); a detached shell process restores it after 30 seconds unless the marker is gone, so a crash of Settings or of the worker cannot leave a broken layout. The page shows "Keep these display settings?" with a 15 second countdown driven by the worker's `status` request (`keep` removes the marker, `revert` and the expired countdown restore the old layout).

Differences from the JS page: the mode, scale, rotation and position fields are `Select` and `Entry` widgets of the toolkit, mode ids are built by the worker (refresh rates with at most six decimals), and the "preview is already pending" state lives in the marker file, so it survives a restart of Settings. Verified: `tests/display-native.test.dev` (6/6) with a stand-in `wlr-randr` (frame, preview/keep/revert, expired countdown, the detached safety process, rejected requests, a rejected dry run and a rejected change) and a real GTK smoke that previews and keeps a scale change. Not verified: a real wlroots compositor, multiple monitors, and pixel parity. The JS Displays page stays the production route.

## Settings: Bluetooth pairing in native Settings

Pairing a new device no longer needs the JS page. `native/devos-bluetooth-agent.c` is a small C program (built by `tools/build/native-bluetooth-agent.sh`, which `tools/build/native-apps.sh` runs, into `dist/native/devos-bluetooth-agent`). For one device path it exports an `org.bluez.Agent1` object, registers it with BlueZ (`KeyboardDisplay`), calls `Device1.Pair` (90 s) and answers PIN, passkey, confirmation and authorization requests. Only requests about the device named on the command line are answered; any other is rejected with `org.bluez.Error.Rejected`, as the JS agent did. It talks to Settings through two files in a private runtime folder (`state` written by the agent, `response` written by Settings), so DevLang needs no D-Bus server.

The worker `bluetooth-page.dev` gained `pair`, `pairing` (poll), `respond` and `cancelPair`. It only starts a pairing for a known, unpaired device, refuses a second pairing, checks the answer (PIN 1–16 characters, passkey up to six digits) before it reaches the agent, reports a finished pairing once, and reports an agent that went silent for two minutes. Every frame now ends with a `P state kind code message device` record. The page shows the question (the code for a confirmation, a field for a PIN or passkey, "Enter this code on your Bluetooth device" for a displayed code) with Confirm and Cancel pairing, and polls every 700 ms while a pairing runs.

Verified: `tests/bluetooth-pairing.test.dev` (6/6) runs the real agent against a stand-in BlueZ (`tests/fixtures/fake-bluez.py`, Python with GIO, a test double only) on a private session bus: confirmation, declined confirmation, PIN, passkey (passed as a number), displayed passkey, authorization, a request about another device, cancel, and refusal of bad device paths. `tests/bluetooth-native.test.dev` (9/9) covers the worker with a stand-in agent and a real GTK pairing. Not verified: a real BlueZ and real hardware, and the `distro/oe` recipe change (one `chmod` line) was not parsed here. The JS Bluetooth files stay until the route is switched.

## Trying native Settings: an opt-in switch

The JS Settings is still what every shell command opens. To try the native one on a session, set `DEVOS_NATIVE_SETTINGS=1` in the shell's environment or create the file `~/.config/devos/native-settings` (`mkdir -p ~/.config/devos && touch ~/.config/devos/native-settings`), then open Settings again. `AppProcesses.launch` (`packages/shell/app-processes.ts`) then starts `dist/native/settings` for every command of the settings role (`settings`, `settings.<page>`, `session.switch-user`) when that executable exists; without it, or without the switch, nothing changes. Commands sent while the window is open reach it over D-Bus (see "shell commands reach the native window"); `settings.bluetooth-add`, `settings.touchpad` and `settings.system` open Bluetooth, Touchpad and About. `settings.background` and `settings.panel` keep their own windows.

Checked here: `tsc --noEmit` passes, the native window answers the commands (tests/settings-command.test.dev, 3/3). Not checked: the shell itself starting the window (no gjs in this environment), a real session, the user-switch dialog (native opens Accounts instead). Remove the file or the variable to go back. The JS Settings files are kept until this has been tried on an image or a VM.

## Screenshot: geometry in DevLang (first step)

`src/apps/org.devos.screenshot/geometry.dev` is `geometry.ts` without GTK: normalised and clipped rectangles, the usable-size rule (4 px), path bounds, thinning of a freehand path (the last point is always kept), scaling a logical selection outwards to image pixels, the image scale, the logical desktop of several monitors, the snip file name from the parts of the local time, and `uniqueIn(directory, name)`, which adds " (2)", " (3)" … so a snip never overwrites an earlier one. `tests/screenshot-geometry.test.dev` (4/4) covers them.

Not ported: the overlay, the editor and the drawing code (`overlay.ts`, `editor.ts`, `drawing.ts`, `toast.ts`, `capture*.ts`), which need Cairo drawing, pointer events on a full-screen layer-shell window and `grim`, and a real Wayland session to verify. No TS file was deleted: the JS Screenshot app is still the production route and `tests/screenshot*.test.ts` import `geometry.ts`.
