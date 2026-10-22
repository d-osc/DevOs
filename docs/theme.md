# Theme settings

Settings → Theme provides a workspace preview, Graphite/Ocean/Plum surface
palettes, five accent presets and a custom #RRGGBB accent. Use Desktop accent
follows the accent from Desktop settings; choosing a preset switches to a
Theme-specific accent. Invalid custom colors disable Apply.

Apply saves `org.devos.theme` preferences. The Theme extension replaces its GTK
CSS provider immediately, updating existing Settings, Files, panel, launcher,
popovers and application headers. Reset discards unapplied choices. Wallpaper,
icon packs, terminal colors and the embedded editor's document theme retain
their separate settings. These palettes style Dev OS surfaces, not unrelated
applications.

Graphite with Desktop accent is the default and preserves the previous CSS.
The preview is a sample workspace, isolated from the real theme until Apply.
The panel's transparent rounded corners remain supported by each palette.

Validation: `npm run build`, `gjs -m dist/theme-settings-test.js` and
`gjs -m dist/extensions-test.js` in a GTK-capable Linux session. The Theme test
compiles every palette, activates the actual extension, checks GTK surface
colors before/after Apply, and verifies accent inheritance, validation and Reset.
