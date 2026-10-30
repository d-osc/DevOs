# @dev-os/compat

GJS compat library for Dev OS. Import from `@dev-os/compat` or its exported subpaths. Set `DEV_OS_ROOT` to the host assets directory when using an installed package.

Build the archive with `npm run compat:pack`.

`@dev-os/compat/display-care` preserves Settings types, file-watch notifications
and read/parse APIs for JS/TS callers. Effective defaults, validation and saved-state reads
are projected by `src/services/display-care-compat.dev`; the initial UI DTO avoids
starting a process during module import. This adapter contains no
parallel JS implementation of those rules. The DevOs host assets and DevLang
runner must be available through `DEV_OS_ROOT` and optionally `DEVLANG_RUN`.

The system panel runs through the DevLang native monitor manager and renderer.
Existing `@dev-os/compat/panel` and `/panel-view` exports retain their JS/TS API
in `panel-legacy/` for external apps and extensions. Those compatibility widgets
and power APIs are not the system panel's runtime. The system folder contains
no JS, TS, TSX or JSX files.
