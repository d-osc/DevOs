# DevLang port: lanes and working rules

Goal (from the user): convert the repository's own JS/TS/TSX/JSX code to DevLang (`.dev` / `.devx`). The existing program
is described in `devlang-repository-migration.md` and `devlang-app-migration.md`; the audit that defines "remaining" is
`d tools/maintenance/migration-audit.dev` (report: `build/migration-audit.json`; `npm run migration:check` fails until
nothing is pending). Decision (2026-10-29, re-confirmed by the user): `packages/*` stays a JS/TS npm SDK, because DevLang has no JS/TS backend
(`d emit` is C only) and TS cannot import `.dev`; porting would mean dropping the nine published packages. What stays TypeScript **by design**: the npm SDK sources under `packages/*` listed in
`data/compat/npm-api.json`, compatibility tests (`tests/*.ts|tsx`), SDK examples. Everything the audit counts as
`system-and-apps` or `tooling` is in scope. Baseline (2026-10-29): 446 TS/JS files remain, 232 of them pending native
ports (`src/apps/*` 160, `src/system/*` ~20, `src/services|root glue` ~16, tooling 6, others).

## How a port is done here (read the finished examples first)

- Finished references: Task Manager (`src/apps/org.devos.taskmanager/native.devx`, `native-main.devx`,
  `src/services/taskmanager.dev`, `lib/processes.dev`), Display Care, Background (`src/system/org.devos.background/*.dev`),
  native login (`src/system/login/`), supervisor (`src/system/supervisor.dev`, `native/supervisor-host.c`), theme palette
  generator (`tools/theme/generate-palette.dev`). UI = `react-devlang` function components in `.devx` (native GTK,
  JSX, state, effects, keyed reconciliation, async service channels); services = separate DevLang worker processes;
  a small C ABI bridge provides GTK/GIO. Build scripts: `tools/build/native-apps.sh`, `native-background.sh`,
  `native-login.sh`, `native-supervisor.sh`.
- Preserve behaviour: same theme tokens/CSS, layout, controls, settings/preferences file formats, helper CLIs
  (`bin/dev-os-*`), D-Bus names and `dev-os-shell <command>` entry points. Compare the original and the native UI
  (the repo has private-Wayland smoke tests that take screenshots, e.g. `tools/test/login-native-smoke.dev`).
- Replace, do not duplicate: when a TS/TSX file is fully ported and the route/loader no longer needs it, delete it
  (the audit counts remaining files) and update the build entry/manifest/launcher route. If the TS version must stay
  as the production frontend until the native one is verified, say so in the report and keep it; never leave both
  half-wired. Never delete a file that an npm-SDK export or a compatibility test still imports.
- Keep third-party libraries in their upstream languages; do not port `node_modules`, vendored code or generated files.
- Tests are DevLang tests (`tests/*.test.dev`, `tools/test/*.dev`) for ported code, run with `d <file>` (WSL:
  `PATH=/home/ondev/.local/bin:$PATH`); GTK tests need Xvfb or a private Wayland session as the existing ones do.
  Compatibility tests under `tests/*.ts|tsx` must keep passing for the npm APIs.

## Lanes (disjoint directories; one session each)

| Lane | Scope |
|---|---|
| A | `src/apps/org.devos.settings/*` pages for hardware and network: audio, speaker, mic-noise, keyboard, touchpad, touchpad-gestures, battery-care, fan-profile, display-care, displays, swap, power, connectivity, wifi, bluetooth*, network*, proxy, printers, device-request, helper-client |
| B | `src/apps/org.devos.settings/*` accounts and the rest: accounts, users, login-view, os-login, new-user, switch-user, avatar, language, time, about, system, input, options, settings-view, radio-row, switch-row, use-helper, index/extension (the registry) and `src/app-settings.tsx`, `src/extensions/org.devos.clock/*` |
| C | `src/apps/org.devos.appstore`, `files`, `launcher`, `installer`, `updates`, `diskmanager` |
| D | `src/apps/org.devos.editor`, `terminal`, `browser`, `screenshot`, `camera`, `microphone`, `icons`, `theme`, `taskmanager` (TS frontends that remain next to the native one) |
| E | `src/system/org.devos.panel`, `org.devos.displaycare`, `src/system/native-*.ts`, `src/main.ts`, `src/login.tsx`, `src/app-data.ts`, `src/app-host.ts`, `src/use-data-view.ts`, `src/services/*.ts`, `src/utils/*` |
| F | tooling: `tools/maintenance/*.mjs|ts`, `tools/store/import-registry.mjs`, `tools/theme/tokenize-css.mjs` (and any other non-SDK JS/TS under `tools/`) |

## Working rules for every lane

1. Work only in your lane's directories. Files shared between lanes (`tools/build/*.sh|ts`, `package.json`, `docs/devlang-*.md`,
   `data/compat/*`, `packages/shell/app-processes.ts`, `lib/*.dev`) get small additive edits only; re-read the file right before
   editing; never reformat or rewrite them; never revert someone else's change. Put new shared DevLang helpers in your own
   directory (or a new `lib/<lane>-*.dev`) rather than editing another lane's file.
2. The tree is uncommitted and shared: do NOT `git commit`, `git stash`, `git checkout`/`reset`, or switch branches. Check
   `git status --short <your dirs>` before and after.
3. No bitbake builds (the OE lock is shared), no USB writes, no disk changes. `distro/oe/build.sh --parse` is allowed after
   recipe edits.
4. After each batch: `npx tsc --noEmit` (compat TS must stay clean), `npm run build`, your DevLang tests, the migration audit
   (`d tools/maintenance/migration-audit.dev`) and record the pending count in your report. Do not leave the tree
   non-building. If another lane breaks the build, tell the main session instead of fixing their files.
5. Update `docs/devlang-repository-migration.md` / `devlang-app-migration.md` with the status of what you ported (short,
   honest: what runs natively, what is verified how, what is still TS and why).
6. Report: files ported/deleted (counts), the audit before/after, tests run and results, what is not verified (real
   laptop/Wayland), and what remains in your lane with reasons (e.g. missing react-devlang widget, GTK API not bridged).
   Missing language/runtime capability is a finding to report, not a reason to fake a port or silently keep both.
