# Background settings

Open Settings → Background. The page provides a preview, DevOs design / Solid
color / Picture, a local picture chooser, color presets and Fill / Fit / Stretch.
Apply saves the settings and updates every monitor. Reset discards the draft.
The existing Desktop background color remains in use until you turn off
“Use Desktop background color” or choose a color preset.

Right-click the desktop → Desktop widgets, or open Settings → Background →
Desktop widgets. Add or remove Clock, Date and Note, choose top-left or top-right
initial placement, then click Apply. Drag any widget’s header with the left mouse
button to place it freely, or click its × button to remove it directly from the
desktop. Each widget moves independently. These changes save immediately without
Apply. Widgets belong only to the desktop where they were added. Switching
desktops shows that desktop’s own widgets, positions and notes. Background
settings follows the active desktop and labels which desktop is being edited;
widget drafts for other desktops remain available until Apply or Reset.
Existing shared widgets migrate to the first desktop only.
Positions use relative screen coordinates, restore after shell restart,
and stay within screen bounds when the display changes size. Arrange widgets /
Reset positions in Settings clears the saved layout after Apply.
Notes support up to 2,000 characters and are edited
in Settings. Reset restores the last saved selection. Widgets are saved with
background preferences, appear on all monitors of their own virtual desktop, and remain
below application windows. Clock/date use local system time and update live.
There is one instance of each built-in widget; third-party widgets are not
supported yet. All widgets start disabled. Removing a note retains its text so
it can be added again later.

Preferences are saved in the `org.devos.background` extension settings file;
the core config schema and existing Desktop color remain compatible. Picture
decoding is asynchronous and bounded to 4096 pixels per axis, preserving image
orientation. Small pictures are not enlarged during decoding. Paths remain local
file references: keep the picture in a persistent location. If a saved picture
becomes unavailable later, the desktop falls back to its background color.

An unreadable or unsupported picture selected in Settings is rejected before
Apply replaces the saved wallpaper. Native supported formats are those exposed
by the installed GdkPixbuf loaders. There is no slideshow or per-monitor selection.

Validation: `npm run build`, then `gjs -m dist/background-test.js` in a GTK-capable
Linux session. The test uses temporary preferences and checks scaling, legacy
color preservation, async decoding, unsaved preview, Apply, invalid file and Reset.

Settings → Background also manages the desktop right-click menu, independently
of Files. It provides a master switch, a preview and on/off controls for fixed
default actions: Applications, Terminal, Files, Background settings, Settings,
Reload shell, Lock and Log out. Default actions cannot be edited or removed;
Log out continues through the launcher's existing confirmation flow.

Custom actions can be added, edited, toggled and removed. Add/Save item updates
the draft; Apply persists it and updates the background on every display. Reset
restores the last applied menu and wallpaper. Desktop commands run in the home
folder, with both `{path}` and `{directory}` referring to that folder. They use
the same direct argument parsing and validation as Files custom actions, but
their preferences are stored separately in `org.devos.background`.

The background owns desktop pointer input so disabling its menu also suppresses
the compositor's fallback root menu. Tab detach/drop support remains attached to
the background. The menu reads current preferences at each click, and existing
menus close when preferences change.

For native validation, run `d tools/test/background-menu-smoke.dev --` on Linux
after building. This compiles the local virtual-pointer helper and starts a
private headless labwc session. It sends real right-clicks, checks native menu
visibility and hidden defaults, dispatches Background settings, runs a temporary
custom command, and checks the master switch. It does not inject input into the
user's desktop. It requires labwc, GJS/GTK, a C compiler, wayland-scanner and the
wayland-client development library; on WSL it prefers the project's private labwc.
