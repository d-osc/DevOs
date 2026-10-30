# Services

Shared service entry points and data processing live here:

- `panel-power.dev`: shared panel power-supply reading and presentation; one worker for all monitors.
- `panel-devices.dev`: shared network, radio, brightness and audio snapshots for the panel.
  Native `wire` requests also aggregate power-supply readings and prepare tray
  icons, labels, capabilities and escaped frames. `systemNetwork` reads raw GIO
  connectivity through the GIO-only panel helper; JSON clients remain supported.
  An explicit nested `action` request validates against fresh hardware facts,
  executes at most one command and acknowledges after refreshing state. Polling
  contains no action and never replays successful or failed commands.
- `panel-device-action.dev`: one-shot device actions; DevLang validates and selects at most one hardware command per request.
- `panel-battery-care.dev`: independent battery-care worker using the existing
  helper/polkit boundary. Read-only polling and explicit full-charge changes are
  separate; current support and preferences are checked before a mutation.
- `panel-menu.dev`: prepared panel menu rows shared across monitors.
- `panel-menu-plan.dev`: one-shot revalidation and literal argv planning for the selected menu action.
- `panel-layout.dev`: layout and live clock presentation for the native panel candidate, including saved layout, core height inheritance and Clock extension preferences.
- `panel-command.dev`: native panel command execution for Time settings, Settings and Wi-Fi settings;
  explicit commands use native shell RPC once and read-only pings never replay them.
- `panel-taskbar.dev`: window grouping, builtin/desktop app identity, pinned entries and prepared task states shared across panel monitors.
  Native clients enable `systemCatalog` to read and monitor raw GIO desktop facts
  in the data process through `libpanel-taskbar.so`; compatibility clients may
  continue sending explicit catalogs. Neither catalog collection nor matching
  requires GTK or GJS in the worker.
  It also accepts persistent native tracker event batches and emits an optional
  escaped presentation frame for the native renderer; JSON snapshot clients remain supported.
- `window-state.dev`: window and workspace aggregation shared by Background and Display Care.

- `services-host.ts`: session services, including lock and sleep handling.
- `app-service-host.ts`: per-app worker process and IPC dispatch.
- `app-service-registry.ts`: lazy registration of app data controllers.
- `preferences.backend.ts`: preferences, configuration and package locations.
- `app-data.backend.ts`: update and extension-store services.
- `app-view-data.ts`: preparation of data for UI views.

App-specific controllers remain beside their apps in `src/apps/`. UI-side IPC clients remain in `src/app-data.ts` and `src/use-data-view.ts`. Compiled process entry names in `dist/` are unchanged.
