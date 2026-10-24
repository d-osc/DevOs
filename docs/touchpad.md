# DevOs touchpad gestures

## Touchpad settings

Settings → Bluetooth & Devices → Touchpad opens the native DevOs page;
`dev-os-shell touchpad` opens it directly. Pointer speed, tap-to-click,
tap-and-drag, natural scrolling, disable-while-typing and left-handed physical
buttons are saved per user in `$XDG_CONFIG_HOME/dev-os/touchpad.json` (default
`~/.config/dev-os/touchpad.json`). Apply updates the current generated labwc
configuration and signals the verified session compositor to reload it.
Keyboard and current desktop settings are preserved. The language/session
configuration generator also incorporates these preferences on future starts.

Devices are identified through udev properties without opening raw input nodes.
With no touchpad attached, the page explicitly reports that state and allows
preferences to be saved for future devices. Unsupported individual driver
options are not emulated. The gesture guide describes the existing compositor
bindings; it does not expose arbitrary gesture remapping.

Validation: `tests/touchpad.test.py` passes with auto/AST engines and tests
validation, per-user persistence/reset, XML isolation/idempotence and a private
live-reload fixture. Language regression tests and GTK settings interactions
pass. The QEMU session additionally passed a real save and labwc reload with
zero detected touchpads. Physical touchpad behavior still requires hardware.

## Gesture map

The DevOs labwc patches own global three/four-finger swipes. One/two-finger
pointer actions remain libinput/client actions. `DEV_OS_TASK_VIEW=1` enables
the compositor bindings in the DevOs session. Locked sessions, input inhibition
and active drag operations cannot trigger global gesture actions.

| Fingers | Action | Result |
| --- | --- | --- |
| 1 | Tap | Left click |
| 1 | Tap, then touch and hold | Drag/drop or text selection; lift to release |
| 2 | Tap | Right click |
| 2 | Scroll vertically/horizontally | Scroll in the focused app |
| 2 | Pinch | Forwarded to the client for zoom when supported by the app |
| 3 | Tap | Applications |
| 3 | Swipe up | Restore the most recently observed minimized window on the current desktop |
| 3 | Swipe down | Dismiss overlays and minimize the active app |
| 3 | Swipe left/right | Next/previous open window on the current desktop, in stable window order |
| 4 | Swipe left/right | Next/previous virtual desktop |
| 4 | Swipe up | Task View |
| 4 | Tap | Unassigned, as requested |

Natural scrolling, tap-to-click, LRM button mapping, tap-and-drag and two-finger
scrolling are explicit in `config/labwc/rc.xml`. Drag lock is disabled so lifting
the dragging finger releases the button. Pinch is not converted into synthetic
Ctrl+wheel events; applications decide whether to zoom.

libinput maps three-finger tapping to a middle-button event. DevOs binds this
event to Applications only on libinput devices with at least three-finger tap
support, tapping enabled and LRM mapping selected. Mouse middle clicks remain
unchanged. A physical middle button on such a touchpad shares the binding,
because wlroots does not distinguish it from the synthesized tap button.
Four-finger taps are not provided by libinput, and hold events are deliberately
not treated as tap events. See the upstream
[tapping](https://wayland.freedesktop.org/libinput/doc/latest/tapping.html) and
[gesture](https://wayland.freedesktop.org/libinput/doc/latest/gestures.html) documentation.

Swipes require at least 70 units of accumulated motion with a dominant axis,
finish within 1.2 seconds and must not be cancelled. A global swipe is consumed
from begin to end so the underlying app does not receive duplicate navigation.
Two-finger gestures are forwarded unchanged. Three-finger gestures require a
touchpad reporting at least three contacts; four-finger gestures require four.

Validation: `tests/task-view-gesture.c` checks mapping, thresholds, invalid
coordinates, cancellation, disabled state and timestamp wraparound. The GJS
Task View tests check window selection, current-desktop filtering and wraparound.
The patched ARM64 labwc build is compiled against the actual image dependencies.
QEMU's USB tablet is not a physical multi-touch touchpad; real tap/swipe/pinch
recognition and thresholds require hardware validation. The exported USB image
must be rebuilt to include these changes.
