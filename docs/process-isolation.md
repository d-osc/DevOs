# Desktop process boundaries

The session supervisor runs the desktop shell and OS service host independently.
Base applications start on demand in a separate GJS process for each application.

| Process | Responsibilities |
| --- | --- |
| `dist/supervisor.js` | Session lifetime, service/shell restart limits and process-group cleanup |
| `dist/services-host.js` | Lock readiness, sleep inhibitors, lid events and periodic update checks; Gio/GLib without GTK or React |
| `dist/main.js` | Desktop shell: panel, launcher, background, display-care overlays and window management |
| `dist/app-host.js <app>` | One singleton UI per base app: native widgets, input, file choosers, clipboard, drawing and animation |
| `dist/app-service-host.js <app>` | One private data worker per app UI: models, filesystem/network/device work, data preparation and helper processes; no GTK or React |
| Installed applications | Their own application processes, launched through the existing desktop-entry/user-cgroup launcher |

Shared core libraries remain reusable code. Loading an app's renderer, native
dependencies or first window happens in its own process, outside the shell's
event loop. This isolates UI stalls; CPU, graphics, memory and disk contention
can still affect the compositor and should be measured on the target hardware.

Commands use asynchronous session D-Bus messages. Bus names are scoped to the
Wayland display and runtime directory, so nested desktops cannot control each
other. Reopening an app uses its existing process. If it crashes, the next launch
starts it again. A shell crash does not close existing apps or stop lock/sleep
services; the supervisor restarts the shell. Services have an independent restart
budget. Logout/version switching stops the session's managed process groups.

Theme and preference files are monitored in every host, with a short debounce.
Settings registers app settings pages as views, without activating the other
apps or creating a second panel/background. Base apps retain their taskbar icons
and system-app identity in the memory policy. User desktop UI extensions remain
shell plugins; installed desktop applications do not run as shell plugins.

After building, start a new Dev OS session to use these boundaries. Existing
sessions keep their already-loaded runtime until they exit.

## Base app UI and data services

All twelve base apps use the data worker. The UI receives prepared snapshots and
sends user actions through asynchronous private stdin/stdout pipes. Session D-Bus
still handles opening apps and shell commands; the data channel is private to its
own UI process. This is process isolation, not a permissions sandbox.

| App | Work owned by the data service |
| --- | --- |
| Settings | Preferences/core configuration, Wi-Fi, Bluetooth/pairing, audio, displays/rollback, accounts, device helpers and update checking/installing |
| Files | Directory metadata, sorted/hidden/folder views, history, creation/rename, recursive indexing and fuzzy search |
| Terminal | Shell integration files, command catalog/history/path suggestions and accepted-completion files; Bash itself already runs in its own process, with VTE retaining the UI/PTY surface |
| Editor | Document contents, UTF-8/BOM validation, loading/saving and conflict protection |
| Camera | Device discovery, capture pipeline, JPEG preview production and photo storage |
| Microphone | Device discovery, capture pipeline, level processing and WAV finalization |
| Task Manager | Process sampler and control helper, search and sorting |
| Browser | URL preparation and download staging/commit/cancellation; WebKit retains its own native content/network processes |
| Disk Manager | Disk inventory and helper response processing |
| App Store | Package inspection/install/remove/rollback, registry identity/bindings, catalog search/joins and extension-store work |
| OS Installer | Availability, disk inventory and the existing guarded installation helper, including progress parsing |
| Screenshot | Capture, cropping, annotation export and PNG storage; GTK overlays, live stroke preview and clipboard ownership stay in the UI |

Controllers live in `*.backend.ts` files. The original entry points are typed UI
facades with cached display state. `src/services/app-service-registry.ts` loads controllers
on demand, so missing camera/GStreamer dependencies do not stop Files or Settings
from starting. The worker does not initialize GTK. Screenshot processing can use
headless Gdk/Cairo image functions without creating windows.

The channel preserves undefined values, icon descriptors, asynchronous callbacks
and references between service-owned controllers. State changes use partial
snapshots. Editor changes are not echoed back as whole documents per keystroke;
camera preview/level callbacks allow only one outstanding update. Closing a view
disposes its controller and callback registrations. Disconnecting the UI closes
the worker's models/monitors/streams and leaves a short cleanup interval for
asynchronous teardown. A worker failure rejects pending requests and leaves the
UI event loop responsive; restoring lost service state requires restarting the
app process or session.

Validation:

```sh
npm run build
gjs -m dist/process-isolation-test.js
d tools/test/process-isolation-smoke.dev --
python3 tests/app-services.test.py
DEV_OS_ROOT="$PWD" gjs -m dist/app-service-client-test.js
d tools/test/base-app-services-smoke.dev --
```

The smoke test creates a private compositor. It checks distinct UI/data PIDs for
all twelve base apps, a stopped data worker while its UI still handles commands, singleton
reuse, a stopped Files process while the shell remains responsive, app recovery,
independent shell/service restarts, and the absence of GTK in the service host.

Native painting also has a buffer-lifetime regression test:

```sh
d tools/test/base-app-services-smoke.dev -- --tests window-buffer-test,window-shape-test,app-store-test
```

The shared window header and JSX renderer release each draw callback's Cairo
context in `finally`. Otherwise its native surface can retain full Wayland frame
buffers until JavaScript garbage collection. The test requests 240 redraws in a
private Wayland compositor and checks the retained buffer count and resident size
without forcing GC. In the reproduced case, retained buffers fell from 221
(732,452 KiB) to 1 (3,312 KiB). These are buffer measurements for the test window,
not the total memory of App Store. Already-running app processes must restart to
load the fixed runtime.
