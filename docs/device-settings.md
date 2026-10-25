# Native device settings

Bluetooth & Devices links to separate DevOs pages for Touchpad, Mouse, Keyboard,
Add a Bluetooth device, and Printers & Devices. The combined Mouse & touchpad
entry has been removed. These pages do not launch external configuration apps.

Mouse preferences control pointer speed, natural scrolling and primary button
layout. They target labwc's `non-touch` libinput category, leaving touchpads
independent. Keyboard preferences control key repeat, delay and rate; a link
opens the existing native language and shortcut page. Both are saved per user in
`$XDG_CONFIG_HOME/dev-os/{mouse,keyboard}.json`, applied to a verified running
labwc session, and restored by the language/session configuration generator.
Existing key bindings and virtual desktops are preserved. A failed save rolls
back the live XML. Disconnected-device preferences can be saved for later.

Bluetooth pairing registers a temporary BlueZ KeyboardDisplay agent on the same
connection that initiates Pair. It supports PIN/passkey entry, code display,
confirmation and authorization. Confirmation requests wait for a user action.
Cancel and page close reject pending requests and cancel pairing; completion
unregisters the agent. No adapter means an empty state, with scanning disabled.
See the [BlueZ Agent API](https://bluez.readthedocs.io/en/latest/agent-api/).

Printers supports manual driverless IPP/IPPS queue creation, per-user default
selection, and confirmed queue removal through CUPS. Queue names and addresses
are validated before commands; arguments are passed without shell interpolation.
Adding/removing queues requires CUPS administration privileges. Errors remain
visible in Settings. The image and shell package include CUPS; a missing service
shows a clear unavailable state. USB-specific drivers and scanner setup are not
implemented. See [CUPS printer administration](https://www.cups.org/doc/admin.html).

Validation includes DevLang helper tests with both execution engines, GTK form
and navigation fixtures, and a D-Bus BlueZ service fixture that exercises explicit
accept/reject and agent cleanup. QEMU validation uses its USB pointer/keyboard and
a local `ippeveprinter` server. Virtual devices do not validate physical Bluetooth
radios, real printers, or physical mouse sensitivity.

The virtual printer accepted queue creation, default selection and removal. A
plain-text print submission was rejected as an unsupported document format by
the test printer; document rendering and physical print output are not validated.

## Keyboard: Function key, automatic backlight and backlight sleep mode

Settings > Devices > Keyboard has three cards modelled on MyASUS, below the repeat settings: **Function key** (Locked Fn key /
Normal Fn key), **Automatic keyboard backlight** (Auto-brighten and Auto-dim, both off by default) and **Keyboard backlight sleep
mode** (Do nothing / While on battery or on AC power / While on battery power only, each timed mode with its own idle-time dropdown:
10 s, 30 s, 1, 2, 5 or 10 minutes, default 1 minute; a dropdown is enabled only while its mode is selected). Every control that
the hardware or session cannot back is shown disabled with the reason; nothing is emulated and no device node is invented.

| Piece | Role |
| --- | --- |
| `bin/dev-os-keyboard` | Python front end and daemon. `get` (JSON: hardware support with reasons, saved settings, AC state), `set fn\|auto-brighten\|auto-dim\|sleep\|sleep-both\|sleep-battery <value>` (values are validated; idle times must be one of the six allowed), `serve`. |
| `native/devos-keyboard` → `/usr/libexec/devos-keyboard` | POSIX sh, root, Fn key mode only: `get`, `set fn locked\|normal`, `apply`. Polkit action `org.devos.keyboard.fn` (`data/polkit-1/actions/org.devos.keyboard.policy`, active local sessions). |
| `devos-keyboard.service` | `apply` at boot: re-applies the saved Fn mode (`/var/lib/devos/keyboard.conf`, `fn=`). With no state file the firmware setting is left alone. |
| `devos-keyboard-backlight.service` (user) | Runs `dev-os-keyboard serve` for the session; started by `devos-desktop` and enabled for `default.target`. Exits at once when there is no keyboard backlight LED. It notices a changed preference within a second. |
| `$XDG_CONFIG_HOME/dev-os/keyboard.json` | Per-user settings: `autoBrighten`, `autoDim`, `sleep` (`nothing`/`both`/`battery`), `sleepBoth`, `sleepBattery` (seconds). Invalid or corrupt content falls back to the defaults. |

Backends:

- **Backlight** is the LED `/sys/class/leds/*kbd_backlight*` (`asus::kbd_backlight`, levels 0 to 3, from the `asus-glymur-ec`
  driver in `native/kernel/asus-glymur-ec/`). It is written through logind `SetBrightness` (no root, works for the active session)
  and falls back to a direct write.
- **Ambient light** is an IIO sensor under `/sys/bus/iio/devices/iio:device*` that has `in_illuminance_input`, or
  `in_illuminance_raw` with optional `_scale`/`_offset`. Auto-brighten switches the backlight on (to the last level in use) when the
  room turns dark, Auto-dim switches it off when the room turns bright. Dark is 15 lux or less and bright is 60 lux or more
  (hysteresis; between them nothing changes), a change has to hold for 3 one-second samples (debounce), and the daemon only acts on
  a change, so a manual choice stays until the light changes again. The first reading is only a baseline. `iio-sensor-proxy` is not
  needed.
- **Idle sleep** speaks the Wayland `ext-idle-notify-v1` protocol itself (no extra package; labwc/wlroots provide it). It asks for
  an input-idle notification (protocol version 2, so a video that inhibits idle does not keep the backlight on), turns the backlight
  off when it fires and restores the previous level on the first key press or pointer motion. "While on battery power only" is
  active only when no mains supply under `/sys/class/power_supply` is online (plugging in restores the backlight). Changing the
  setting replaces the notification; switching it off while asleep restores the backlight.
- **Fn key mode** is `/sys/devices/platform/asus-nb-wmi/fn_lock` (1 = Locked, hotkey function is primary; 0 = Normal).

**This laptop (ASUS UX3407NA, Snapdragon X Elite):** the keyboard backlight LED exists. The kernel patch and the Live USB hardware
reports show no `asus-nb-wmi` `fn_lock` node and no IIO ambient light sensor, so on this board the Function key and Automatic
backlight cards are expected to appear disabled with an explanation, while the sleep mode works. Remapping F1 to F12 in software
is not offered: the Fn row comes from the embedded controller as media keycodes and there is no virtual keyboard to turn them
into plain function keys. Check on the laptop: `python3 /usr/bin/dev-os-keyboard get`, `ls /sys/class/leds`,
`ls /sys/bus/iio/devices`, `ls /sys/devices/platform/asus-nb-wmi`.

Validation: `python3 tests/keyboard.test.py` (27 tests: helper against a fake sysfs, preference validation, ambient light with
hysteresis and debounce, and idle sleep against a fake Wayland compositor that speaks the wire protocol, including battery-only
and AC changes), and `node tools/build/build.ts` then `GDK_BACKEND=wayland gjs -m dist/keyboard-ui-test.js` (the three cards,
radios, switches, dropdowns, saved state, disabled states with reasons).

**Not verified on real hardware:** the logind `SetBrightness` call on the asus-glymur-ec LED, labwc's `ext-idle-notify-v1`
behaviour on the real compositor, whether the keyboard backlight key handling in the EC fights the daemon, the meaning of
`fn_lock` 1/0 on a machine that has it (taken from the asus-wmi documentation), the pkexec path with a real polkit agent, and the
systemd units on a booted image. The Live USB must be rebuilt to include this.
