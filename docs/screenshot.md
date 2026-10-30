# Screenshot (snipping tool)

`org.devos.screenshot` is a snipping tool in the style of the Windows 11 Snipping Tool.

| Action | How |
|---|---|
| Start a snip anywhere | **Super+Shift+S** (also **Print Screen**), or `dev-os-shell screenshot` |
| Open the Screenshot window | the launcher entry **Screenshot**, or `dev-os-shell screenshot-app` |

## Taking a snip

The desktop is captured once with `grim` (wlr-screencopy, already in the image) and shown frozen and dimmed on every
monitor; the snip is cut from that frozen frame, so it is exactly what was on screen. A bar on the monitor under the
pointer offers the modes:

- **Rectangle** (`R`): drag a rectangle. The snip is taken when the mouse button is released.
- **Freeform** (`F`): draw any outline; pixels outside it are transparent in the PNG.
- **Full screen** (`S`): click a monitor (or press Enter) to take that whole monitor.
- **Esc**, right-click or **Close** cancels.

There is no Window mode: a Wayland client cannot learn where other windows are, and labwc offers no window geometry.

The snip is copied to the clipboard, saved as `Pictures/Screenshots/Screenshot YYYY-MM-DD HH-MM-SS.png` (a number is added
if the name is taken) and announced by a small card in the top-right corner. Click the card to open the snip in the
Screenshot window.

## The Screenshot window

- **New snip** with a mode and a delay (none, 3, 5 or 10 seconds). The window hides while the snip is taken.
- **Pen** and **Highlighter** in six colours, **Undo** and **Clear marks**.
- **Copy** and **Save** (Save asks for a name; marks are burnt into the exported PNG; the earlier automatic file is not modified).
- **Open folder** opens `Pictures/Screenshots`.

## Notes and limits

- Capture needs `grim` and a compositor that allows screen capture (labwc does). Without it the window shows the reason.
- The clipboard image is served by the Dev OS shell process, so pasting works as long as the shell is running.
- On a HiDPI display the capture is taken at the output's native resolution; the snip keeps the full detail.
- Tests: `tests/screenshot.test.ts` covers geometry, crops, saving, annotations, native GDK mouse/key events and command routing.
  Run `gjs -m dist/screenshot-live-test.js` inside an isolated labwc session with `grim` and `wtype` to verify actual desktop capture,
  the layer-shell overlay and Enter confirmation. The live test injects a key, so use a separate test session.
