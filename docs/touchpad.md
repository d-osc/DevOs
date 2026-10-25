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

## Touchpad lock and Smart Gestures (MyASUS style)

Settings → Bluetooth & Devices → Touchpad starts with two cards modelled on MyASUS. The helper is `bin/dev-os-touchpad-gestures`
(DevLang, `lib/touchpad-gestures.dev`, runs as the user, no polkit action). State lives in `$XDG_CONFIG_HOME/dev-os/touchpad-gestures.json`
(`locked`, `enabled`, `launch`); invalid or foreign values fall back to the defaults (unlocked, gestures off, Task Manager).

**Touchpad lock.** Unlock/Lock switch, "When set to Lock, touchpad input is disabled." Locking saves the choice, then
re-runs `dev-os-touchpad save` with the saved pointer settings. `lib/touchpad.dev` adds
`<sendEventsMode>no</sendEventsMode>` to the generated labwc touchpad device block while the saved state is locked, so
libinput stops delivering the touchpad to the compositor, and `bin/dev-os-language` (session start) regenerates the
same block, so the lock survives logout and reboot. If the compositor reload fails the saved state is rolled back and the
error is shown. Locking is refused when no touchpad is found; unlocking is always possible. `config/labwc/rc.xml` binds
`XF86TouchpadToggle`, `XF86TouchpadOff` and `XF86TouchpadOn` (the Fn+F9 style touchpad key, when the keyboard driver
sends it) to `lock toggle|on|off` and a `notify-send` toast is shown when available.

**Smart Gestures** (off by default, "Enable/disable advanced gestures"). `dev-os-touchpad-gestures serve`
(`devos-touchpad-gestures.service`, a user unit enabled in `default.target.wants`; the Live USB session starts it through
`dev-os-touchpad-gestures apply`, which falls back to a transient `systemd-run --user` unit) opens the touchpad's
`/dev/input/eventN` read-only with `O_NONBLOCK` and never grabs it. It finds the touchpad in `/proc/bus/input/devices`
(absolute X/Y plus `BTN_TOOL_FINGER`), reads the axis range with `EVIOCGABS` and watches multitouch slots. While gestures
are off or the touchpad is locked it opens no device at all and notices a settings change within a second.

| Gesture (one finger) | Starts in | Action |
| --- | --- | --- |
| Slide up/down | left 8% strip | `wpctl set-volume` ±5% per step, limit 100% |
| Slide up/down | right 8% strip | `dev-os-backlight -- up|down` (real backlight, 5% per step) |
| Slide right/left | top 8% strip | MPRIS `Player.Seek` ±5 s per step over `busctl --user` (the playing player first) |
| Swipe inward (down-left) | top-right 15% corner | `dev-os-shell <target>`; target is chosen in Settings: Task Manager (default), Application launcher, Task View, Settings, Files, Terminal or Nothing |

One step is 5% of the edge length of travel. The touch must start inside the zone, move at least 3% and mostly along
the edge (1.5× more along than across) before anything happens; a mostly sideways start, a second finger or a start
outside the zones cancels the gesture until every finger has lifted. The corner swipe fires once per gesture with a 1.5 s
cooldown. Launch targets come from a fixed list; a custom command cannot be stored.

**Honest limitations.**
- The device is observed, not taken over, so the pointer still moves while a finger slides along an edge (libinput has no
  per-zone event filtering). Taps are not generated by sliding, so nothing is clicked.
- The seek gesture needs a player that implements MPRIS and `busctl`; brightness needs a real backlight; each gesture is
  listed as "unavailable on this system" when its tool or device is missing.
- Reading `/dev/input/event*` needs access: `72-devos-touchpad.rules` tags touchpad event nodes `uaccess` for the active
  seat user, and the Live USB session runs as root. If the node is still unreadable the gestures card is disabled with the
  reason while the lock keeps working. No device path is ever invented; with no touchpad both cards are disabled.
- No panel indicator was added; the lock state is shown only in Settings and in the hotkey toast.

Validation: `tests/touchpad-gestures.test.py` (21 tests: detection from a fake `/proc` device list, state validation and
persistence, lock apply/rollback through a fake touchpad helper, service start and transient fallback, the recognizer with
synthetic multitouch streams for every zone and for non-triggering pointer use, and the daemon reading a fake event file
and running fake `wpctl`/`dev-os-backlight`/`busctl`/`dev-os-shell`), `tests/touchpad.test.py` (the `sendEventsMode`
XML), and `tests/touchpad-gestures-ui.test.tsx` (`gjs -m dist/touchpad-gestures-ui-test.js`: card text, switches,
failures, missing touchpad, unreadable node, missing backends). **Not verified on real hardware:** whether the
installed labwc honors `<sendEventsMode>`, whether the UX3407NA touchpad is readable and its Fn+F9 key reaches labwc as
`XF86TouchpadToggle`, real gesture thresholds on the physical pad, and MPRIS seeking on a real player. A new Live USB or
image must be built to include these files.
