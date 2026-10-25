# Launcher settings

Applications and Task View share a timed animation: 220 ms fade/slide-in
and 150 ms fade-out, with cubic ease-out. The surface stays fullscreen while its
contents move by up to 20 pixels. Reversing a transition resumes from its current
opacity; closing releases exclusive keyboard focus immediately. Animations honor
GTK’s enable-animations setting, and pending animation timers are removed on reload.

Regular app windows now use compositor animations too: 220 ms fade/slide-in and
150 ms fade/slide-out, including restored/minimized managed windows. The shared
map/unmap integration covers native Wayland and managed XWayland views. A retained
last-frame scene-buffer cache allows a closing window to fade after the client
has destroyed its surfaces. It holds buffer references (no pixel readback), is
refreshed at most every 33 ms, and is released with the view. Transitions preserve
normal focus/stacking metadata and are completed before an actual desktop switch.
Locking or destroying scene nodes cancels pending animation resources safely.
DevOs enables this through `DEV_OS_WINDOW_ANIMATIONS=1`; setting it to `0` before
starting a session disables regular-window transitions. A complete DevOs session
restart is required after rebuilding this compositor integration.

`d tools/test/desktop-animation-smoke.dev --` checks actual rendered app opening
and closing frames, quick close, and desktop-transition interaction on the private
compositor. The private WSL compositor build has XWayland disabled, so that
backend is integrated through the shared source path but not runtime-tested here.

Settings → Launcher now provides a layout preview, Comfortable/Compact spacing,
search-field width (420–900 pixels), app icon size (20–40 pixels), workspace shortcuts,
app descriptions and remembering the last search. Apply saves the extension
preferences and reloads the launcher; Reset discards unapplied choices.

The preview uses example Terminal, Files and Editor rows. The real menu keeps
its installed app catalog, complete search results, keyboard navigation, Settings,
Lock and confirmed Log out. Applications fills the selected monitor, including
the panel area, and scrolls its app list while keeping search and actions visible.
Close it with Escape, the close button, or its existing toggle shortcut. The
search width is constrained to fit the monitor; the legacy `menuWidth` preference
now controls the search field. Existing settings retain the defaults: 600-pixel search width,
28-pixel icons, comfortable rows, descriptions and workspace shortcuts enabled,
and a fresh search on each opening.

Remember search keeps the query while opening and closing the same launcher.
It does not write search history to disk; restarting/reloading the launcher
clears it. Changes to these options affect the real menu after Apply.

All Applications has List and Grid view buttons beside its app count. Both views
support search, single-click launch and keyboard selection. The selected view is
saved immediately. Workspace has Add apps / Edit workspace controls: enable edit
mode, use + (or Add to Workspace in Grid) to pin an installed app, and use × on a
Workspace shortcut to remove it. Terminal, Files and Editor shortcuts can also be
removed. Removing a shortcut does not uninstall an app. Workspace scrolls
horizontally when needed and supports up to 64 shortcuts. View and shortcuts
persist across shell restarts, and applying Launcher settings preserves them.

Preferences are stored with `org.devos.launcher`, independently of core config.
Validation: `npm run build`, then `gjs -m dist/launcher-settings-test.js` in a
GTK-capable Linux session. The test checks preview, Apply/Reset and the real
launcher's search retention, density, descriptions, shortcuts and logout guard.
`d tools/test/launcher-smoke.dev --` additionally checks actual fullscreen
dimensions, search, real Escape and closing/reopening on private headless labwc.
