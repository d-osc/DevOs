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

`src/system/org.devos.launcher/model.dev` holds the pure rules of the launcher: option clamping (`options.ts`), the workspace app list and app view (`customization.ts`), which entries may offer Uninstall (`userPackageCommand` of `uninstall.ts`: only `dev-<command>.desktop` files in the user directory, regular files and not symlinks, whose Exec is `… --root <store> run <command>` for the same command; `dev-os-*` base apps never qualify) and the lines of the Info menu item. `tests/launcher-model.test.dev` (4/4) mirrors the cases of `tests/launcher-uninstall.test.ts`.

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

## Files: native window (opt-in)

`src/apps/org.devos.files/native.devx` is a native Files window (`dist/native/files`, built by `tools/build/native-apps.sh`). Its worker `service.dev` lists a folder, creates a folder, renames and opens a file with `gio open` (the path is shell-quoted); the rules are `model.dev` (names that cannot leave the folder, natural order with folders first, no overwrite, `~`/`..`/relative paths). The window has Back, Forward, Up, Refresh, a path field, Places (Home, Desktop, Documents, Downloads, Music, Pictures, Videos), a hidden-files switch, New folder, and Open and Rename on every row. The shell command `files <path>` opens that folder in the running window.

Try it with `DEVOS_NATIVE_FILES=1` or `mkdir -p ~/.config/devos && touch ~/.config/devos/native-files`; `AppProcesses` (`packages/shell/app-processes.ts`, now `nativeEnabled(app)` for Settings and Files) then starts `dist/native/files`. Without the switch, or without the binary, the JS Files app runs as before.

Verified: `tests/files-native.test.dev` (5/5): the service (listing, order, hidden files, path resolution, create, rename, refusals, quoting of a name with an apostrophe) and a real GTK run that opens a folder and creates a folder in it. Not ported yet, so the JS Files app stays: search (`search*.ts`), the custom context menu and its settings, package install from the list (it still imports the App Store TS), grid view, Open with…, drag and drop. Not verified: a real session and the default-application launch (`gio open` is replaced by a stand-in in the test).

## Terminal: native window (opt-in) and how DevLang reaches libraries without headers

`src/apps/org.devos.terminal/native.devx` is a native Terminal window: one VTE terminal that runs the user's shell (`$SHELL`, or `sh -c $DEVOS_TERMINAL_COMMAND` in tests), 10,000 lines of scrollback, Ctrl+Shift+C and Ctrl+Shift+V (the "copy-clipboard" and "paste-clipboard" action signals of VTE), and it closes when the shell exits, whatever the exit status. The window is built by `tools/build/native-apps.sh` into `dist/native/terminal` only when `libvte-2.91.so.0` is installed (otherwise the step is skipped and the JS Terminal stays the only one). Try it with `DEVOS_NATIVE_TERMINAL=1` or `~/.config/devos/native-terminal`; the shell commands `terminal` and `terminal.*` then reach this window (`terminal.native <folder>` only brings it to the front for now).

The point of this step is the method. No VTE header or `-dev` package is needed: the program declares the few VTE functions it calls with `extern fn` (`vte_terminal_new`, `vte_terminal_spawn_async`, `vte_terminal_set_scrollback_lines`), `build.sh` links the library by path (the way the panel links `libgtk-layer-shell`), and the VTE widget is added to an empty host box of the toolkit with `gtk_container_add`. Two small helpers in `packages/react-devlang/native/gtk.c` cover what DevLang cannot express safely: `rd_strv_new`/`rd_strv_set` build the `char **` argument, and `rd_close_on` / `rd_terminal_keys` connect signals by name from C. A DevLang `callback_context` handed to `g_timeout_add` or `g_signal_connect_data` crashed when GLib called it (a segmentation fault even for a handler that only printed), so signals that must reach DevLang are not connected that way. The same approach should work for WebKit (Browser, Editor), GStreamer (Camera, Microphone) and GtkSourceView (if installed); `libwebkit2gtk-4.1` and `libgstreamer-1.0` runtime libraries are present here, GtkSourceView is not.

Verified: `tests/terminal-native.test.dev` (3/3) runs the real window under Xvfb: a command writes a file and sees a terminal on stdin (a real pty), a failing command (`exit 7`) still closes the window, and the two clipboard action signals exist on this VTE. Not ported, so the JS Terminal stays: tabs and splits, colours and font from the theme, the Terminal settings (font, scrollback, bell, hyperlinks, right-click paste), command suggestions/completion, shell integration, opening in a given folder, and more than one window. Not verified: copy and paste with a real selection (the shortcut is wired, not driven by a test), and a real session.

## Browser: native window (opt-in), and the toolkit clock

`src/apps/org.devos.browser/native.devx` is a native Browser window: a WebKit view (`libwebkit2gtk-4.1`, linked by path like VTE, so no WebKit header is needed) with Back, Forward, Reload, an address field and Go. An address with a scheme or `about:` / `file:` is used as typed, text with a dot gets `https://`, and anything with spaces or without a dot becomes a DuckDuckGo search. The shell command `browser <address>` loads that address in the running window. It is built into `dist/native/browser` by `tools/build/native-apps.sh` only when the WebKit runtime is installed; start it with `DEVOS_NATIVE_BROWSER=1` or `~/.config/devos/native-browser`.

WebKit reports its state through signals, and a DevLang callback handed to GLib crashes (see the Terminal section). So `packages/react-devlang` gets a clock: `rd_tick` in `gtk.c` emits an event of kind 8 every N milliseconds through the same dispatch path as every other event, and `ui.onTick(context, milliseconds, handler)` runs `handler` on the window's thread. The Browser reads the address, title, back/forward state and loading flag every 500 ms with it; any native app that wraps a C library can do the same.

Verified: `tests/browser-native.test.dev` (2/2) runs the real window under Xvfb with the sandbox and GPU compositing off: it loads a local page and reads its title, then a typed address is loaded when Go is pressed (the second page's title is read). Not ported, so the JS Browser stays: tabs, downloads, the inspector, the context menu, bookmarks and history, find in page, certificate and permission prompts, zoom, and opening links in a new window. Not verified: a real session with GPU rendering and the sandbox on, and network pages (the tests use `file://`). One test run of `diskmanager-native` failed once while the whole native build was fresh (123 s) and passed on the rerun.

## Camera: native window (opt-in), GStreamer through extern fn

`src/apps/org.devos.camera/native.devx` is a native Camera window and `service.dev` its worker. The preview is the widget of a GStreamer `gtksink` (fetched with `rd_object_pointer`, a small `gtk.c` helper for the variadic `g_object_get`), placed in a host box of the toolkit. The same stream (`tee`) also writes its newest frames, two per second, as JPEG files to a private folder; "Take photo" copies the newest finished frame to `~/Pictures/Camera` (created 0700, names like `2026-10-30_20-46-51-bd2bdf12.jpg` that never repeat), so no GStreamer buffer ever has to be mapped from DevLang. The device list is `/dev/video*` named from `/sys/class/video4linux/*/name`, with a Test pattern entry (`videotestsrc`) always last; Stop removes the frame folder, and frame folders older than a day are pruned at the next start. libgstreamer is linked by path (no header), `gst_init`, `gst_parse_launch`, `gst_element_set_state`, `gst_bin_get_by_name` and `gst_object_unref` are declared with `extern fn`. Start it with `DEVOS_NATIVE_CAMERA=1` or `~/.config/devos/native-camera`; `tools/build/native-apps.sh` builds it only when libgstreamer is installed.

Verified: `tests/camera-native.test.dev` (4/4): the service (device list and names, the test pattern, the frame folder, photo selection and the private folder, refusal of foreign folders and bad requests, the opener) and a real GTK run under Xvfb that starts the test pattern, shows the preview and saves a photo that begins with the JPEG signature in a 0700 folder. Not ported, so the JS Camera stays: the Microphone window (level meter and WAV recording need GStreamer bus messages), device hot-plug, resolution choice, video recording, and removing the frame folder when the window is closed while the camera runs (it is pruned the next day). Not verified: a real camera (`v4l2src ! decodebin`; this machine has none) and a real session.

## Microphone: native window (opt-in), reading the GStreamer bus without callbacks

`src/apps/org.devos.microphone/native.devx` (worker `service.dev`) is a native Microphone window: pick an input (the pulse sources from `pactl`, monitors and unsafe names left out, a test tone always last), test its level, or record it to a WAV file in `~/Music/Recordings` (created 0700, names like `2026-10-30_21-10-20-110625db.wav` that never repeat). Stopping a recording sends EOS and waits up to 5 seconds for it, so the WAV header is finished; a device error discards the unfinished file (only a `.wav` directly inside the recordings folder can be discarded).

The level meter shows the method for anything that reports through GStreamer messages: every 250 ms clock tick (`ui.onTick`) the window takes the pending element messages from the pipeline's bus with `gst_bus_pop_filtered`, turns the structure into text with `gst_structure_to_string` (`level, … peak=(GValueArray)< -1.93 >, …`), and parses the loudest channel's peak. The meter is that peak on a −60…0 dB scale (the JS window used a linear scale). EOS and error messages are taken with their own masks, so no `GstMessage` struct layout is needed. Start it with `DEVOS_NATIVE_MICROPHONE=1` or `~/.config/devos/native-microphone`; `native-apps.sh` builds it with libgstreamer.

Verified: `tests/microphone-native.test.dev` (4/4): the service, and a real GTK run under Xvfb that records the 440 Hz test tone for two seconds, reaches a peak of 968 of 1000 and leaves a finished WAV (`RIFF…WAVE`, about 700 KB) in a 0700 folder. Not verified: a real microphone (`pulsesrc`; no audio device here), the settings page's noise-cancelling controls (those stay in Settings), and a real session. Not ported: the JS window's shared look with the Camera.

## App Store: native window (opt-in) on top of the real DevOsPM

`src/apps/org.devos.appstore/native.devx` is a native App Store window with three tabs, and `service.dev` is its worker. **Apps** is the catalog (`registry-data.json`, the same data as the generated `registry-data.ts`, so the TS file can go with the JS App Store): search, and Install or Reinstall. Install downloads the catalog's own Linux ARM64 package (an https address only, never one from a request; `curl` with `--proto =https`, at most 10 redirects, 2 GiB, 280 s) into a private temporary folder, runs `dev install`, remembers which catalog app became which package in the same `bindings-<store hash>.json` file the JS App Store keeps, and removes the folder. **Installed** lists `dev list --json` (version, previous version, kind, size, commands) with Remove and Roll back. **Install a file** takes a full path to a `.dpk`, `.deb`, `.rpm` or `.tar.gz`. DevOsPM does the extracting, checking and registering, and its own words are shown when it refuses (for example "invalid gzip header" for a damaged archive); its stderr is merged into the output the way the JS page did. The shell commands `package-install <file>` (from Files), `app-store`, `extension-store` and `settings.store` reach the window; the first opens the "Install a file" tab with the path filled in. Start it with `DEVOS_NATIVE_APPSTORE=1` or `~/.config/devos/native-appstore`.

Differences from the JS App Store, on purpose: the package is not opened and previewed before installing (the JS page read the `.deb`/`.rpm`/tar headers to show blockers, a size and the commands; here DevOsPM's own checks decide, and an install from a file always uses `--replace`, which keeps the old version for Roll back), a download is not shown as a progress bar (the status says it can take minutes), and the Extensions tab and the app icons and screenshots are not ported. `package-rules.dev`, which already has the file-kind and path rules, is used for the file check.

Verified: `tests/appstore-native.test.dev` (5/5) runs the worker against the real `build/wsl/bin/dev` (DevOsPM 0.7.0) with a private store, a private HOME and a stand-in `curl`: the catalog (valid apps only, https ARM64 downloads only), install, the binding, no leftover download folder, replace, roll back, remove, refusal of bad requests and of a damaged archive, a non-ARM64 host, a failed download and a missing package manager; and a real GTK run under Xvfb that installs a catalog app. Not verified: a real network download, a real `.deb` or `.rpm`, and a real session.

## Editor: native window (opt-in) around the same Monaco bundle

`src/apps/org.devos.editor/native.devx` is a native Editor window: a path field with Open and Save, a status line (path, modified, line and column) and a WebKit view that runs the Monaco bundle in `dist/editor`, the same one the JS Editor loads. Monaco itself stays JavaScript (a build output, like the 6 MB TypeScript worker); everything around it is DevLang. Turn it on with `touch ~/.config/devos/native-editor` (or `DEVOS_NATIVE_EDITOR=1`); the JS Editor stays the default.

Three workers and one trick make it work without WebKit callbacks:

- `server.dev` serves `dist/editor` on a loopback port under a secret path segment (Monaco's language workers need an HTTP origin). `std/http` can only send text, so the build now inlines the icon font into `app.css` (`loader: {'.ttf': 'dataurl'}`); the JS Editor gets the same file and its CSP allows `font-src data:`. A watcher in the worker ends it when the window's process is gone, because `listen` never returns.
- `service.dev` reads and writes the file (UTF-8 only, 8 MB limit, binary refused). The text travels as a JSON string literal, so the window can paste it straight into `devOsEditor.configure({content: …})` and the page can hand it back as `JSON.stringify(getValue())`.
- The page talks to the window through `document.title`. A user script defines `window.webkit.messageHandlers.editor.postMessage` (what `browser/index.tsx` already calls) and keeps a queue of events, shown one at a time as `DOE<seq>|<kind>|<payload>`: ready, change, cursor, action (Ctrl+S, Ctrl+N …), error, and content (the text, when the window asked for it with `__devosDump()`). `ui.onTick` reads the title every 100 ms, handles the event and acknowledges it with `__devosAck(seq)`. The window calls the page with `webkit_web_view_evaluate_javascript` without a callback.

Not in the native Editor yet: tabs (one file per window), a file chooser (type the path), Save As to another path other than editing the field, the "changed on disk" check, keeping a byte order mark, a prompt on closing with unsaved changes, and opening a file passed on the command line of a fresh window (a running window takes `editor <file>` from the shell).

Verified: `tests/editor-native.test.dev` (1/1) builds the window against the installed libwebkit2gtk and runs it under Xvfb: the file worker and the server worker start, Monaco loads from the server (workers included), the text Monaco holds equals the file byte for byte (quotes, tab, `ü`), an edit made in the page is saved, and the file on disk holds it. No server process is left behind. Not verified: a real session, the theme switching on a live change, Ctrl+S inside Monaco (the action path is wired but the test saves through the Save button).

## Launcher: native window (opt-in)

`src/system/org.devos.launcher/native.devx` is a native Launcher window and `service.dev` is its worker; `dist/native/launcher` is built by `tools/build/native-apps.sh`. It searches and launches the installed applications (list or grid, the same search rules as `searchApps`: every word in the name, description, id or keywords, names that start with the query first), keeps the Workspace shortcuts (pin and unpin while editing, Terminal, Files and Editor go to the shell as commands), and has Settings, Lock, Restart, Sleep, Shutdown and Log out with the same confirmations. The worker reads the desktop entries itself with the visibility rules of `Gio.AppInfo.should_show` (Type, NoDisplay, Hidden, OnlyShowIn, NotShowIn, TryExec; a user entry that is hidden masks the system one), launches through `bin/dev-os-app-launch` as the JS launcher does, asks logind for what is available, and stores the app view and the workspace in `~/.config/dev-os/extensions/org.devos.launcher.json` through `lib/ext-prefs.dev`, keeping every other value. `model.dev` (options, workspace rules, the uninstall rules) is used as it was.

Not in it yet, and why the JS launcher is still the one the shell runs: the full-screen layer-shell overlay and its open/close motion (needs gtk-layer-shell and a real Wayland session to check; Xvfb has neither), keyboard navigation (arrow keys, Enter, Escape: the toolkit has no key events yet), the right-click menu with Info and Uninstall, and the shell integration (the `launcher`, `logout` and `overlays-hide` commands still go to `extension.ts`). Task View (`task-view.tsx`), the snap panel and sashes (`snap-view.tsx`, `snap-sashes.ts`) and `overlay-motion.ts` need the compositor's window list and the window gestures, so they are a separate step. None of the TypeScript was deleted.

Verified: `tests/launcher-app-native.test.dev` (3/3): the worker's list against a private set of entries (NoDisplay, Hidden masking, TryExec, sorting, keywords), saving, and refusal of unknown commands and power actions; and the window under Xvfb, which searches `zed`, launches the single result and switches to the grid, with the choice stored. Nothing is launched and no shell command is sent in the tests. Not verified: a real session, the logind calls, real shell commands, icons other than the theme's.

Shell wiring (opt-in): `touch ~/.config/devos/native-launcher` (or `DEVOS_NATIVE_LAUNCHER=1`) and make sure `dist/native/launcher` exists (`sh tools/build/native-apps.sh`). `src/system/org.devos.launcher/extension.ts` then sends the shell's `launcher`, `logout`, `launcher.hide` and `overlays-hide` commands to the native window through `packages/runtime/native-launcher.ts`: the window is one process per session on the D-Bus name `org.devos.App.launcher.<shell id>`; `launcher` toggles (a running window closes, a missing one is started, with the shell's theme in its environment), `logout` starts it on the log-out confirmation or asks a running one for it, and the hide commands close a running window and never start one. Without the switch or without the executable the JS launcher runs exactly as before; `optInNative(name)` in `packages/runtime/processes.ts` is now the one place that reads the switch (`nativeEnabled` in the shell uses it too). Task View and the snap panel keep using the JS code in the same extension.

Verified: the extension builds (`npm run typecheck`, `npm run build`), and `tests/launcher-app-native.test.dev` (4/4) now also runs the window under `dbus-run-session` and sends it what the shell sends over D-Bus: `launcher logout` is accepted and keeps the window open, a foreign command is refused with "Unsupported app command", and `launcher` closes the window. Not verified: the spawn path from the shell (`nativeLauncher` starting the window when none runs), which needs a real shell session; the JS side was only type-checked and built.

### Launcher: native Task View (opt-in)

`src/system/org.devos.launcher/task-view.devx` (built as `dist/native/task-view`) and its worker `task-service.dev` are a native Task View window: the open windows of the current desktop as cards (click to bring one forward, × to close, a menu to move it to another desktop) and the desktops (switch, add, remove, with the window count of each). The window starts `dev-os-window-tracker` itself (`DEVOS_TASKVIEW_TRACKER` replaces it in tests), batches its JSON event lines every 100 ms to the worker, and forwards the commands the worker approves (`activate`, `close`, `desktop`, `move`, `create-desktop`, `remove-desktop`, the same lines the JS Windows service wrote) back to the tracker; the worker keeps the state with `src/services/window-state.dev` and names and icons with the taskbar's `taskbar.dev`, so the Task View and the taskbar agree on what a window is. Switch it on with `touch ~/.config/devos/native-task-view`; `extension.ts` then sends `task-view`, `task-view-show`, `task-view-hide`, `snap-layouts` (hides it) and `overlays-hide` to the window through `packages/runtime/native-launcher.ts`, and the JS Task View runs as before otherwise.

Not in it: the layer-shell overlay and its motion, keyboard navigation (Tab, arrows, Enter, Esc), and the snap panel and sashes (`snap-view.tsx`, `snap-sashes.ts`), which still need the tracker's snap and sash commands in a window of their own.

Verified: `tests/launcher-app-native.test.dev` (6/6): the worker against tracker events (desktop names, groups, icons, and that an unknown window, an unknown desktop or a missing capability produce no tracker command), and the window under Xvfb with a stand-in tracker (`tests/lib/fake-tracker.sh`): it lists the windows of the current desktop and clicking one sends `activate 12` to the tracker. Not verified: the real tracker (needs a Wayland compositor), the shell routing from a live session, moving windows between desktops in a real compositor.

### Launcher: native Snap window and snap groups (opt-in)

`src/system/org.devos.launcher/snap-panel.devx` (built as `dist/native/snap-panel`) is a native Snap window: five layouts (two columns, wide left, wide right, three columns, four quarters), a window chosen for every region, Apply (the tracker is sent `snap <id> devos-<region>` and `activate <id>` for each member and then one `sash` line), and a Groups tab with Restore and Remove. `task-service.dev` (the worker shared with the Task View, which also keeps the tracker plumbing in `shell-link.devx`) now holds the snap state: `snap-model.dev` is a DevLang port of `packages/services/snap-geometry.ts` and of the member rules in `windows.ts` (one desktop, no sticky windows, no repeats, the right number of windows), including the minimum-size limits of every divider and the fitting of a group before it is applied. The groups are written to `$XDG_RUNTIME_DIR/devos-snap-groups.json` (`DEVOS_SNAP_STATE` in tests), so they outlive the short-lived window and last until sign-out; a group loses closed windows and disappears below two members or when its windows are on different desktops, as the JS Windows service did. Switch it on with `touch ~/.config/devos/native-snap-panel`; `extension.ts` then sends `snap-layouts` (and the hide of every other overlay) to it.

Two deliberate differences: the sashes of the JS version are a transparent layer-shell overlay that you drag; the native group card has Narrower and Wider buttons for every divider (`resize-group`, 5 % a step) that send the same `sash` command and obey the same minimum sizes. And it is an ordinary window, without the layer-shell overlay, the motion and the layer-shell keyboard handling.

Verified: `tests/launcher-app-native.test.dev` (8/8): the worker refuses a repeated window, the wrong number of windows and a layout that does not fit; stops a divider where a 200 px minimum width leaves room (2100 to 7900 of 10000 on a 1000 px area); restores with the resized cuts; keeps the group in a new worker process; drops it when a member closes; and the window under Xvfb with the stand-in tracker applies a layout and the tracker receives the `snap` and `sash` lines. Not verified: the real tracker and compositor (`snap` and `sash` have only been checked against the stand-in), dragging, the shell routing from a live session.

### Launcher: no TypeScript left; the native windows are the default

`src/system/org.devos.launcher` now holds only DevLang (`model.dev`, `service.dev`, `native.devx`, `task-service.dev`, `task-view.devx`, `snap-panel.devx`, `snap-model.dev`, `shell-link.devx`) and `extension.json`, whose manifest is `"native": "launcher"` (no JS entry; the loader treats it like the panel). The eleven TypeScript files were deleted: `view.tsx`, `index.ts`, `extension.ts`, `task-view.tsx`, `snap-view.tsx`, `snap-sashes.ts`, `overlay-motion.ts`, `settings-view.tsx`, `customization.ts`, `options.ts` and `uninstall.ts`, together with their six GJS tests and build entries.

The shell (`packages/shell/index.ts`) routes `launcher`, `logout`, `task-view`, `task-view-show`, `task-view-hide`, `snap-layouts` and `overlays-hide` straight to the native windows through `packages/runtime/native-launcher.ts`; there are no opt-in switches for these three any more, and opening one closes the others. The Launcher's Log out sends `session.quit` after its confirmation. The Launcher settings page is the generic native extension page (the manifest's settings), and the JS Settings app no longer registers a page for it.

Full screen: the three windows are layer-shell overlays. `packages/react-devlang/native/gtk.c` (`RD_LAYER=1`, which the Launcher, Task View and Snap set) opens `libgtk-layer-shell.so.0` at run time with `dlopen`, so no header or link is needed, and puts the window on the overlay layer, anchored to all four edges, exclusive keyboard, exclusive zone -1, with a translucent scrim over the screen; the content is a centered panel (`rd-layer-panel`), and Escape closes the window. Without the library or on a compositor without the protocol (X11, Xvfb) the same code is an ordinary window, and `rd_app_header` skips the title bar for an overlay.

What is still different from the JS version, on purpose: no open/close motion; no arrow-key navigation or Enter (the toolkit has no key events beyond Escape); no right-click menu with Info and Uninstall; the snap sashes cannot be dragged and are replaced by Narrower and Wider buttons on each group card; clicking the scrim does not close the overlay. The overlay is checked against a real layer-shell compositor (the labwc build of this repository running headless: layer 3, anchor 15, exclusive keyboard, sized to the whole 1280x720 output), but not on a real display, so the look (scrim, panel size, fonts) is unchecked.

## Files: no TypeScript left; the native window is the default

`src/apps/org.devos.files` now holds only DevLang (`model.dev`, `search.dev`, `custom-menu.dev`, `service.dev`, `native.devx`, `native-main.devx`) and `extension.json` (`"native": "files"`, no JS entry). The thirteen TypeScript files were deleted (`view.tsx`, `index.ts`, `extension.ts`, `model.ts`, `model.backend.ts`, `search.ts`, `search.backend.ts`, `search-view.tsx`, `context-menu.ts`, `custom-menu.ts`, `custom-menu-settings.tsx`, `settings-view.tsx`, `presentation.ts`, `package-open.ts`) with `tests/files-settings.test.tsx`, its build entry, the two Files entries of the app service registry and the Files case of `app-view-data.ts`; `tests/package-install.test.ts` and `tests/app-service-client.test.ts` lost the parts that exercised them. The shell always starts `dist/native/files` (`NATIVE_APPS` in `packages/shell/app-processes.ts`; Files is no longer an opt-in app), and the Files settings page is the generic native page that renders the manifest.

What the native window gained to replace the JS one: the **start folder, hidden files and grid view** preferences; **icon grid** next to the list; **Quick Open** (Search: type to find files below the current folder; the fuzzy ranking of `search.backend.ts`, the excluded-folders setting, at most 30,000 files and 100 results); a **selection and an action bar** whose buttons follow the right-click menu settings: Open, Install (the file is a `.dpk`, `.deb`, `.rpm` or an installable `.tar.gz`; it opens the App Store installer through the shell's `package-install`), Rename, Copy path (to the clipboard, `rd_clipboard` in `gtk.c`), Open in Terminal (the shell's `terminal` with the folder as its directory) and the **custom actions** of the settings (target any, file, folder or background; the command is split like a shell and `{path}` and `{directory}` are replaced, then run without a shell).

Differences from the JS Files, on purpose: no right-click menu or drag and drop (the toolkit has neither; the action bar replaces the menu); no tabs (one folder per window); a failing custom action cannot report its exit status (it is started in the background); an Install offer for a `.tar.gz` is checked when you press it, not before; collation of non-Latin names compares bytes.

Verified: `tests/files-native.test.dev` (10/10): the start folder and the settings flags, the search ranking and exclusions, the install checks and the shell commands that reach the shell, custom action argument splitting, plus the window under Xvfb browsing into a folder and creating one, and searching, opening a result and the opener getting its path. A screenshot of the grid view under a headless labwc was checked by eye. Not verified: a real session, the real installer and terminal hand-off, and the GJS tests that were edited (they cannot run here; `tsc` and the build pass).


## Shell (native, opt-in)

`src/system/org.devos.shell/` is the DevLang shell that will replace `packages/shell` (GJS). `native.devx` is a program with no window (`RD_HIDDEN=1` in `gtk.c`: the window is never shown and the control call carries the caller's folder first) that owns the shell's D-Bus name (`org.devos.Shell.s<hash>`) and answers `org.devos.Shell.Control.Execute`, so `dev-os-shell <command>`, the native apps and the JS apps keep talking to it unchanged. `router.dev` holds the command rules (`handleArguments` and `appForCommand` of the old shell), and `service.dev` carries them out: a running app is asked over D-Bus, a missing one is started (`dist/native/<app>`, else the JS app host), the Launcher, Task View and Snap are opened or closed, `terminal`, `files` and `lock` follow the config, messages go out as the `org.devos.Panel` signal, and `session.quit` ends the program. Tests: `tests/shell-native.test.dev` (router, worker log, and the program on a private D-Bus under Xvfb).


Also fixed on the way: the Launcher worker did not load `libsupervisor.so`, so its Settings, Files, Terminal, Lock and Log out buttons failed with a missing native symbol on a real system; `sp.linkWith` passes the library and a test covers it.

Opt in with `DEVOS_NATIVE_SHELL=1` or `mkdir -p ~/.config/devos && touch ~/.config/devos/native-shell`; `bin/dev-os-shell` then starts `dist/native/shell` instead of GJS (without the binary nothing changes). It now also does what the GJS shell did besides routing: the window gestures (`gestures.dev`: the tracker is asked for the windows and sent `activate <id>`), the Theme choice (`theme.dev`: the Theme extension's saved mode, family and Auto schedule pick `dist/native/theme.<family>.<name>.css`, copied to `$XDG_RUNTIME_DIR/devos-native-theme.css` at start, every 5 seconds and on `reload`, so native windows switch dark/light by themselves), and `reload` (re-applies the theme). `screenshot` and `screenshot-app` launch the Screenshot app exactly as before, and the Icons extension is loaded by each JS app host, not by the shell, so neither needs anything here. Not carried over: user extensions (dropped by decision), the restore-order memory of minimized windows (`window-restore` brings back the highest-id minimized window instead of the most recently minimized), and the unused `devos-memory-policy.json` the GJS shell wrote (nothing reads it).

**Why `packages/shell` is still there.** `src/app-host.ts` creates a `DesktopShell` for every JS app process (Screenshot, Camera, Microphone, the JS Settings, App Store, Terminal, Browser and Editor roles that have no native default, and the app settings pages), so the class is the base of every JS app that still runs. It can be deleted only together with `app-host.ts`, `src/main.ts` and the last JS app (stage 5 of `docs/gjs-removal-plan.md`); the native shell above only replaces it as the desktop's shell process. Not verified on a real session.

## Terminal: no TypeScript left

`src/apps/org.devos.terminal` holds `native.devx`, `native-main.devx`, `extension.json` (`"native": "terminal"`) and the README. The ten TypeScript files (`extension.tsx`, `completion.ts`, `suggestions.ts`, `shell-integration.ts`, `keyboard.ts`, `right-click.ts`, `colors.ts`, `options.ts`, `data.backend.ts`, `settings-view.tsx`), their five TS tests and the two Python Bash-integration tests were deleted, together with the Terminal settings page, the `terminal/data.TerminalData` service entry, the terminal contrast test of `theme-css.test.ts` and the build entries. The shell (`packages/shell/app-processes.ts` and the native shell's `service.dev`) now always starts `dist/native/terminal`.

Decision (the owner, 2026-10-31): the native Terminal may lose what the JS one had. **Gone:** command suggestions, tabs, the themed ANSI palette (VTE defaults apply), right-click paste, and the effect of the Terminal settings (font, bell, links, scrolling are stored but ignored). Not verified on a real session.

## Settings, Camera and Microphone: no TypeScript left

Decision (the owner, 2026-10-31): go through the JS apps one by one and make the native window the default. `src/apps/org.devos.settings`, `org.devos.camera` and `org.devos.microphone` now hold only DevLang and `extension.json` (`"native": "settings"`, `"camera"`, `"microphone"`). Deleted: the 82 Settings TS/TSX files, the Camera and Microphone TS (`window.ts`, `capture.backend.ts`, `settings-view.tsx`, `extension.ts`, ...), `src/login.tsx` (the greeter is the native `src/system/login`), the `settings/*` and `camera/capture.MediaData` service entries, the network projection of `app-view-data.ts`, the Camera, Microphone, Terminal pages of `app-settings.tsx`, the `login` build entry, 28 TS test files that imported them (all GJS tests: they could not be run here; `tsc` and `npm run build` pass), and the Camera/Microphone part of `tests/app-service-client.test.ts`. The shell (`packages/shell/app-processes.ts` and the native shell's `service.dev`) starts `dist/native/<app>` for Settings, Terminal, Camera, Microphone, Files and the other native apps; only Browser, App Store and Editor are still opt-in. DevLang tests run: settings-native 8, camera-native 4, microphone-native 4, microphone-noise 16, terminal-native 3, extensions-native 4, shell-native 7, launcher-app-native 11, files-native 10, appstore-native 5, supervisor-native 15, settings-command 3. Not verified on a real session; the user-switch dialog opens Accounts, and the per-app cosmetic pages are not carried over.

## Task Manager, Disk Manager, Updates: no TypeScript left

`src/apps/org.devos.taskmanager` and `org.devos.diskmanager` keep only DevLang and a manifest with `"native"` (they were already the shell's native apps); `org.devos.updates` is a `"kind": "settings"` manifest (its page is the native Settings Updates page). The TS (`extension.tsx`, `settings.tsx`, the process and disk backends, `view.tsx`), the `taskmanager/*` and `diskmanager/*` service entries, the processes projection of `app-view-data.ts`, their Settings pages in `app-settings.tsx` and four TS tests (`task-manager`, `process-metrics-live`, `disk-manager`, `updates-ui`) were deleted. taskmanager-native 11, diskmanager-native 5, settings-native 8, extensions-native 4, shell-native 7 and supervisor-native 15 pass; `tsc` and `npm run build` pass.
