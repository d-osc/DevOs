# Removing GJS: every `packages/*` and app TS/TSX file becomes DevLang

Decision (the owner, 2026-10-30): GJS is not wanted any more; everything under `packages/` and `src/` that is JS/TS/JSX/TSX becomes DevLang, and the
system keeps working at every step. `packages/core` is the React-on-GJS renderer that the shell, the app host and every JS app import (290 files), so
it can only be deleted last. This is the order that never leaves the desktop without a working shell. Line counts are measured, not estimated.

## What is left (TS/TSX, `.d.ts` excluded)

| Area | Files | Lines | What it is |
|---|---:|---:|---|
| `packages/core` | 23 | 2,041 | React renderer, widgets, theme, window header (GJS only) |
| `packages/shell` + `src/main.ts`, `app-host.ts`, `app-data.ts`, `app-settings.tsx`, `login.tsx`, `use-data-view.ts` | 8 | 620 | the GJS shell: command registry, app processes, hotkeys, app host |
| `packages/runtime`, `services`, `extensions`, `supervisor`, `config`, `src/services`, `src/extensions` | 43 | 1,900 | process roles, D-Bus services, extension loader |
| `packages/updates` | 11 | 1,251 | update client (DevLang ports exist under `src/apps/org.devos.updates`) |
| Apps: Settings 82 files / 3,708 · AppStore 17 / 1,817 · Files 14 / 1,074 · Launcher 11 / 952 · Terminal 10 / 795 · Editor 10 / 699 · Screenshot 8 / 678 · Browser 8 / 454 · Taskmanager 7 / 365 · Camera 6 / 313 · Icons 5 / 270 · Updates 2 / 224 · Theme 3 / 145 · Diskmanager 3 / 76 · Microphone 2 / 44 | 188 | 11,614 | JS apps run by `app-host` |

Already native (DevLang + GTK): panel, background, login/greeter, splash, supervisor, task manager, disk manager, installer, display care.
Native but not yet the default: Settings (opt-in with `DEVOS_NATIVE_SETTINGS=1`).

## Stages (each one ends with a system that boots and a test run)

1. **Settings becomes the default** (3,708 lines, 82 files, plus `src/legacy/` 9 files). Needs one real session or VM check of the opt-in switch,
   then flip `settings` in `packages/shell/app-processes.ts`, delete the JS Settings and the TS tests that import it.
   Open: the user-switch dialog (native opens Accounts), per-app cosmetic pages.
2. **Apps that need no new toolkit widget**: Files (a native window exists behind `DEVOS_NATIVE_FILES=1`: browse, create, rename, open; search, context menu and package install remain),
   Launcher (overlay as a layer-shell window; `model.dev` exists), App Store (package rules in `package-rules.dev`; the `.deb`/`.rpm`/tar readers
   come from the update code), Icons, Theme, Updates, Camera settings page. ~4,800 lines.
3. **Apps that need a toolkit bridge first** (each bridge is a C function plus a test in `packages/react-devlang`):
   Terminal → VTE (a native window exists behind `DEVOS_NATIVE_TERMINAL=1`, linking libvte by path without headers); Browser → WebKit (a native window exists behind `DEVOS_NATIVE_BROWSER=1`: address, back, forward, reload; tabs, downloads and the inspector remain); Editor → GtkSourceView or WebKit; Camera (native window behind `DEVOS_NATIVE_CAMERA=1`: preview and photo; the Microphone and video recording remain) and Microphone capture → GStreamer; Screenshot → layer-shell overlay and Cairo
   drawing. ~3,100 lines.
4. **Native shell**: replace `src/main.ts` and `packages/shell` (command registry, `AppProcesses`, hotkeys, workspaces, tray) with a DevLang program
   that uses the D-Bus control interface the native apps already expose (`org.devos.Shell.Control`). The supervisor already restarts native parts independently.
5. **Remove the GJS stack**: `app-host`, `packages/{core,runtime,services,extensions,supervisor,config,updates,shell}`, `src/services`, `src/extensions`,
   the esbuild step in `tools/build/build.ts`, the `@dev-os/*` aliases in `tsconfig.json`, `data/compat/npm-api.json`, the `*:pack` scripts, and `gjs`
   from the image. `packages/core` goes here, when nothing imports it.

## Rules that keep it from breaking

- A native replacement is added first and made the default behind a switch (`DEVOS_NATIVE_<APP>=1` or a file under `~/.config/devos/`), tried on a session,
  and only then are the JS files and the tests that import them deleted together.
- No stage deletes a file that something still imports; the build (`tsc --noEmit`, `npm run build`) and the DevLang tests run after every stage.
- The public npm packages stop existing with their last TS file (as `@dev-os/compat` did); the contract in `data/compat/npm-api.json` loses them in the same change.

## Verified so far

`tsc --noEmit`, `npm run build`, the native Settings test suites (16), the pairing agent against a stand-in BlueZ, and the DevLang audit
(`d tools/maintenance/migration-audit.dev`: 383 TS/JS files left on 2026-10-30). Not verified: a real session with native Settings as the default,
real Bluetooth hardware, a real wlroots compositor for the Display page.

## What the GJS shell really holds (measured, for stage 4)

`src/main.ts` (47 lines) starts `DesktopShell` (`packages/shell/index.ts`, 337 lines), a `Gtk.Application` that
- runs a UI runtime for the *shell extensions* `theme`, `icons`, `launcher`, `panel`, `background` and `displaycare` (`SHELL_EXTENSIONS` in `packages/runtime/processes.ts`); the panel, background and display care are already native processes, so what is still JS inside the shell is the Launcher overlay (with the task view and snap layouts) and the theme and icons extensions;
- owns the window manager gestures (`Windows`: next, previous, restore) fed by `native/window-tracker.c`, config reload, the toast messages, the screenshot overlay commands and the D-Bus control object (`org.devos.Shell.Control.Execute`) that every `dev-os-shell <command>` call reaches;
- launches the JS apps through `AppProcesses` (native ones where one exists);
- loads **user extensions**: third-party packages whose `dist/<entry>.js` is imported at start (`packages/extensions/user.ts`).

So a native shell comes after, not before: the Launcher overlay (and snap, task view), the Screenshot overlay, the theme and icons extensions, and the window gestures must exist natively first.

## Decisions that are the owner's

1. **User extensions.** Third-party JS UI extensions cannot run without GJS. Either the extension API is replaced by a native one (a DevLang program that speaks the control protocol, with a manifest like today's) and existing JS extensions stop working, or GJS stays for them as an optional component. Nothing in the repo decides this yet.
2. **Editor.** The JS Editor is Monaco in a WebKit view (`dist/editor`, a 6 MB TypeScript worker). A native Editor is either a WebKit view with the same bundle (DevLang for the window, JS inside the page) or a text widget with its own highlighting (GtkSourceView is not installed here).
3. **npm packages.** `@dev-os/runtime`, `services`, `shell`, `extensions`, `updates`, `config` and `supervisor` are published API contracts (`data/compat/npm-api.json`); they go when their last TS file goes, as `@dev-os/compat` did.

## Decision 1 is made (the owner, 2026-10-30): JS user extensions are no longer supported

GJS goes away completely. The JS extension API (`packages/extensions/user.ts`, `UIExtension`, `registerSettingsPage`) ends with it; a native extension API (a DevLang program that speaks the control protocol and declares itself in a manifest) is a separate, later design, and existing JS extensions stop working when the shell does. Consequence for the order: nothing has to be kept for them, so `packages/core`, `extensions`, `runtime`, `services`, `shell`, `supervisor`, `updates` and `config` are all deleted in stage 5, in that dependency order, with their entries removed from `data/compat/npm-api.json`.
Decisions 2 (Editor) and 3 (the npm packages, now answered by this one) remain; the Editor is still open.
