# Background settings

Open Settings → Background. The page provides a preview, DevOs design / Solid
color / Picture, a local picture chooser, color presets and Fill / Fit / Stretch.
Apply saves the settings and updates every monitor. Reset discards the draft.
The base color follows the Dark or Light theme until you turn off
“Use theme background color” or choose a color preset.

The default DevOs design is drawn procedurally (`extensions/org.devos.background/design.ts`), so it needs no image
files and fills any resolution or aspect ratio. It layers soft mesh-gradient glows built from the active theme's
accent (shifted a little around the color wheel), two translucent dunes, a vignette and a faint grain tile that
dithers away gradient banding. It follows
the Dark / Light theme (including Auto): the Dark variant keeps most pixels near the theme's dark base for OLED
panels and has no large bright areas, while Light uses pastel glows. Solid color and Picture modes are unchanged.
Settings → Background → Design picks one of twenty-four looks: Dunes (the default), Aurora (sweeping light ribbons), Contours (topographic rings) Facets (a low-poly mesh), Waves (hairline sine waves), Bokeh (defocused light discs), Orbits (tilted elliptical rings), Horizon (a faint perspective floor) Mosaic (rounded tiles), and five animated designs: Flow (drifting color glows), Ripples (rings spreading from a point), Fireflies (twinkling motes rising slowly), Tide (slow rolling waves) and Planets (bodies moving along orbits), plus five space scenes: Starfield (twinkling parallax stars over a faint Milky Way band), Nebula (slowly drifting gas clouds), Galaxy (a rotating spiral), Meteors (shooting stars crossing a starfield every few seconds) and Eclipse (a glowing planet with an orbiting moon), and five hacker scenes in phosphor green tinted by the theme accent: Matrix (falling glyph columns), Terminal (scrolling fake shell and hex-dump panels with a blinking prompt), Circuit (PCB traces with data pulses), Radar (a sweeping scope with fading blips) and Network (drifting nodes passing packets). They are drawn natively with Cairo rather than in a web view, which keeps them light on CPU and memory; on the Light theme they become a pastel “dawn sky” with faint accent-colored stars. Animated designs are drawn at a third (space and hacker scenes: half) of the screen size and scaled up. Quick scenes (Matrix, Terminal, Circuit, Radar, Network, Meteors) redraw 15 times a second, the slow ambient ones 10 times a second, and both run at half that on battery (the power source is looked at every 30 s). A frame is only queued at idle priority, so input and the panel always go first. Drawing stops while a maximized or fullscreen window of the active desktop covers the monitor (`pace.ts`, `monitorCovered`), and while the screen is off (DPMS) or locked wlroots stops sending frame callbacks to surfaces it does not draw, which should stop GTK as well (expected from the protocol, not checked on the laptop). Pick any static design to stop the animation. How the frame cost was brought down (measured with `gjs -m dist/wallpaper-bench.js`, see `docs/performance.md`): soft glows are alpha sprites that are scaled and stamped instead of full-surface radial gradients, the edge shade is a cached mask, thousands of stars are filled with one path per alpha step, Matrix glyphs are cached alpha masks instead of shaped text, and the dither grain goes onto the small scene instead of over every panel pixel (the scene stays ARGB32 because an RGB24 source takes pixman's slow path onto the ARGB32 window). All motion is slow and low-contrast, which also spreads pixel wear on OLED. The choice is stored as `style` and unknown values fall back to Dunes. To preview them, run `DEVOS_WALLPAPER_PREVIEW=<dir> gjs -m dist/wallpaper-design-test.js` after building
(`wallpaper-design-test`), which writes `wallpaper-<style>-dark.png` and `-light.png`.

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
the core config schema remains compatible (the old `accent` and `background` keys are read and ignored). Picture
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
