# Panel settings

Settings → Panel provides a layout preview, top/bottom screen position, three
size presets, panel height (32–96 pixels), app icon size (14–28 pixels), button
spacing and section spacing. Terminal/Files launch shortcuts and the date below
the clock can be hidden independently. Running apps remain accessible when
their launch shortcuts are hidden.

The real panel and preview share an 8-pixel corner radius and background color.
The native surface clears its alpha channel before painting the rounded frame,
so the desktop remains visible through the corners.

Apply saves `org.devos.panel` preferences and recreates the panel on every
display. Reset restores the last saved choices. Existing installations keep the
bottom position, 16-pixel icons, shortcuts and date. A height of zero follows
Desktop's `panel_height`; switching off that option allows a custom height.
The panel reserves space on its selected screen edge and opens its popovers
towards the workspace. Clock formatting continues to come from Clock settings.

Validation: `npm run build`, then `gjs -m dist/panel-settings-test.js` in a
GTK-capable Linux session. Tests cover Desktop height inheritance, bounds,
preview isolation, Apply/Reset, both positions, icon size, system controls and
access to running Terminal windows with launch shortcuts hidden.

Settings → Panel also provides a right-click menu preview, a master switch and
on/off controls for protected default actions: Panel settings, Applications,
Terminal, Files, Clock settings and Settings. Defaults cannot be edited or
removed. Right-clicking a panel button opens this menu without invoking its
normal left-click action. It works at both screen edges and on each monitor.

Custom actions support Add/Edit/Remove, enablement and Apply/Reset, independently
of Files and Background menus. Commands run in the home folder; `{path}` and
`{directory}` refer to that folder. Add/Save item edits the draft; Apply saves
and reloads panel surfaces. Existing geometry, icon, shortcut and date choices
are preserved when saving the context menu. Invalid commands are rejected, and
execution errors appear in panel alerts.

Native validation: after building, run
`d tools/test/background-menu-smoke.dev -- panel top` and
`d tools/test/background-menu-smoke.dev -- panel bottom` on Linux. The harness
uses a private headless compositor and virtual pointer to check real panel
right-clicks, settings routes, custom commands and the master switch without
injecting events into the user's session.
