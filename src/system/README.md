# System components

Desktop infrastructure lives here and is displayed under **System**, separately from applications:

- `org.devos.panel`: desktop panel and its menus.
- `org.devos.displaycare`: display care and OLED protection effects.
- `org.devos.background`: desktop background and animations.

`supervisor.dev` manages session process lifetimes and restarts through
`lib/session-supervisor.dev`. The session entry uses this DevLang implementation;
the npm `@dev-os/supervisor` export is a JS/TS binding to the same implementation.

`splash.dev` is the native compositor boot animation, built as
`dist/native/boot-splash`. It follows the framebuffer milestones and keeps the
original dot font, colours, spinner and fade, without a JS runtime.

Display care's overlay renderer is native DevLang (`native.dev`), with a separate
DevLang worker (`service.dev`) and pure processing module (`model.dev`). Its native
manifest is supervised independently from the shell, and its native window tracker
feeds the worker directly. `native-host.c` provides GTK/layer-shell lifecycle and events;
mask geometry, gradients and refresh colours are rendered in DevLang. The shared
panel-care behaviours still belong to the current JS panel.

Background uses one native UI and separate DevLang data worker per monitor. Its
`model.dev` validates the original 24 styles, colours and picture settings,
calculates per-monitor coverage and selects the animation interval from the power
source. The native manager tracks outputs and restarts failed UI processes.
Background Settings also runs as a separate native window with its own data worker.
The public JS/TS background API (`packages/compat/background-legacy`) was removed with `packages/compat`.
Display Care contains only DevLang sources and its native manifest: no JS, TS,
TSX or JSX. Settings parsing and panel Pixel Shift planning run in DevLang through
`display-care-compat.dev`; dimming/geometry rules are in `geometry.dev`. Remaining
JS Settings consumers use the transport-only adapter in `src/legacy/display-care.ts`.
The current JS Panel owns its GTK adapter in `org.devos.panel/panel-care.ts` and
receives settings/margins from DevLang. Shell-rule tests are now DevLang too.
Panel is still JS and has not been declared migrated.
The layout-only native JSX candidate is `org.devos.panel/native-layout-preview.devx`.
Start an isolated session with `DEVOS_PANEL_RENDERER=native-preview` in the
session environment; this selects the preview instead of the legacy renderer.
Build it with `sh tools/build/native-panel.sh`, then run
`DEV_OS_ROOT="$PWD" DEVOS_PANEL_PREVIEW=1 dist/native/panel-layout-preview` in a
Wayland session. `DEVOS_PANEL_MONITOR` selects a monitor. Its separate
`panel-layout.dev` service loads saved layout and core height, prepares bounded
layout values, and reloads on polling. The candidate uses the system theme and
layer-shell with an exclusive work area. It is a diagnostic layout preview.
Session-bus ownership prevents the preview from stacking over a legacy panel
or another native panel on the same monitor. Ownership is released on shutdown.
The layout smoke selects the native renderer for its isolated session, so its
screenshots contain only one panel rather than both renderers.
It now displays live time/date prepared by `clock.dev` in the data worker, including
Clock extension formats, seconds, locale, timezone and invalid-format fallback.
`clock-host.c` only exposes GLib time APIs and loads no GTK in that worker.
The clock button now opens a native popup with prepared weekday, full date,
seconds and timezone, retaining the original text styles. Time settings uses a
separate DevLang command worker and native shell RPC. Its command queue is
one-shot; polling never replays a command. The worker rejects unsupported
commands and the native panel displays RPC errors.
Other popups, tray and other interactions still need porting before production
can switch. `d tools/test/panel-layout-smoke.dev` checks the second monitor,
top/bottom/height changes, X11 refusal, process maps and descendant shutdown.
The native candidate now renders live taskbar rows from its own native tracker
and separate DevLang service. It applies builtin/serialized GIcons, tooltips,
running dots and active/minimized styles while retaining widgets across group
updates. Tracker events are transported in bounded batches. Task buttons remain
enabled for pinned launches and single-window minimize/activate. DevLang chooses
the action from the latest tracker state; GTK only forwards the prepared command.
Multiple-window buttons now open a native GTK popover with individual window actions.
The Source taskbar worker now prepares picker labels and control states and accepts
`windowAction: {group, id, action}` for activate, minimize, maximize and close.
Each action checks current group membership and state; maximize toggles restore,
stale windows are rejected, and polling never repeats a command. Native popup rows
update as windows change or close. Pinned pickers expose New window through an
explicit service launch request; pin removal removes that capability. Polling
does not repeat successful or failed RPC launches. Hover opens a nonmodal preview
after 400 ms and closes 250 ms after leaving; entering the popup cancels closure.
Right-click opens a modal picker and promotes an existing hover preview. Single
windows retain the Minimize/Restore, Maximize/Restore size and Close button layout.
Pending timers are cancelled on teardown and never activate a window themselves.
The native taskbar worker reads GIO desktop IDs, display names, StartupWMClass
and serialized GIcons through `taskbar-catalog.dev` and `catalog-host.c`. It caches
facts until the application monitor changes, including installation/removal and
metadata edits. The helper library links GIO without GTK or MozJS; grouping and
presentation stay in DevLang. JSON compatibility clients can still supply their
own catalog without loading this helper.
The smoke opens and closes a real native test window and checks its task entry;
`d tests/panel-taskbar-render-native.test.dev` checks GTK rendering and cleanup.
Tray presentation now has a DevLang `tray-model.dev`: network/audio icons,
tooltips, radio and slider capabilities, and battery visibility/styles. Native
wire requests to `panel-devices.dev` combine existing device and power readers;
GIO can supply connectivity without a JS adapter. `native-tray.dev` renders these
prepared indicator frames, with GTK tests for decoding, clicks, battery removal
and cleanup. A native Quick settings popup now connects to the device worker,
including Bluetooth, mute, volume and brightness, with pending/error states and
Settings/Wi-Fi settings routes. It updates disabled controls when hardware goes
away. Compatibility one-shot actions and native persistent actions share the
same DevLang executor. The diagnostic panel now mounts this tray and popup.
Battery-care controls use an independent DevLang worker, preserving the existing
helper/polkit boundary, quick-switch preference and remaining-time labels. A
denied request restores the previous switch state without retry. Other device
controls keep their independent worker while authorization is pending. The
Wayland smoke opens Quick settings with virtual pointer input, dismisses it by
clicking the panel outside the popup, and checks all six child processes exit.
Power-supply reading, fallback counters, status interpretation and presentation
now run in `src/services/panel-power.dev` using `org.devos.panel/power-model.dev`.
All panel monitors share one worker through the compatibility IPC adapter.
Network/radio, backlight and audio reads now run in `src/services/panel-devices.dev`
using `org.devos.panel/devices-model.dev`. This second worker is also shared across
monitors. The UI transports the GIO connectivity fact and receives prepared state;
device actions use the separate one-shot `panel-device-action.dev` worker.
DevLang re-reads device capabilities, validates numeric values, selects the backend
and creates the command arguments. The JS compatibility client only transports
the request and error; failed actions are never replayed.
Panel context-menu filtering, labels, separators, custom-action validation and
argv preparation now live in `org.devos.panel/menu-model.dev`. A shared worker
prepares presentation rows; a separate one-shot request revalidates the current
preferences before activation. GTK still renders the menu and dispatches the
prepared shell command or literal argv. The existing JS menu API remains for
compatibility clients and Settings previews.
The production panel's taskbar now uses `panel-taskbar.dev` and `taskbar.dev` to
prepare app groups, builtin/desktop identities, pinned entries, icons, labels,
tooltips and active/minimized states. All monitors with the same window source
and pin setting share one worker. GTK renders prepared rows and keeps its existing
window picker/actions. Serialized GIcons use a bounded render-side cache.
The synchronous JS grouping API remains available to compatibility clients.
`src/legacy/native-model.ts` contains only the JS transport for the remaining JS consumers.

Build: `sh tools/build/native-system.sh`. Validation:
`d tests/system-displaycare-native.test.dev` and `d tools/test/system-native-smoke.dev`.
Background model validation: `d tests/system-background-native.test.dev`.
IPC/restart validation on a private two-monitor desktop:
`d tools/test/background-runtime-smoke.dev`.
Panel power: `d tests/panel-power-native.test.dev` and `d tools/test/panel-power-smoke.dev`.

The shared system loader discovers both `src/system/` and `src/apps/`, preserving activation order, package IDs and saved settings. Application windows remain in `src/apps/`.
