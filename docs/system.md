# System settings

Settings → System groups the main device/system pages. Desktop, Date & time
and Language are entries inside System, rather than separate Preferences sidebar
items. System remains highlighted while those subpages are open. Direct commands are
`dev-os-shell system`, `display`, `sound`, `power`, `storage` and `about`.

- **Display** is a native DevOs settings page with monitor selection, supported
  resolution/refresh modes, scale, orientation and positions for multiple screens.
  Apply previews the change; Keep confirms it and Revert restores the old layout.
  A 15-second confirmation timer and independent 30-second watchdog protect
  against an unusable screen, including when Settings exits. Changes affect the
  current desktop session; startup profiles and enabling disabled outputs are
  not yet exposed.
  On WSL it opens Windows display settings on explicit click, because the
  session's nested output does not describe the physical Windows screens.
- **Sound** is a DevOs page for output/microphone selection, volume and mute,
  plus volume, mute and output routing for applications currently playing audio.
  It uses the session's PipeWire/PulseAudio service through pactl JSON and does
  not launch pavucontrol. Defaults apply to new streams; existing playback can
  be routed per app. Monitor sources are excluded from the microphone list.
  Device ports, card profiles and per-recording-app controls are not exposed yet.
- **Power & battery** has DevOs battery status cards, charge bars and selectable
  power-mode cards. It reads charge/state from Linux, plus health, charge cycles
  and estimated charging/discharging time when the kernel exposes those values.
  Missing batteries and unsupported modes have explicit empty states rather
  than empty dropdowns. It exposes only profiles advertised by
  power-profiles-daemon. Native profile changes use
  its D-Bus ActiveProfile property with normal authorization. WSL directs
  profile changes to Windows power settings instead.
  Both `org.freedesktop.UPower.PowerProfiles` and the legacy
  `net.hadess.PowerProfiles` service are supported through typed busctl JSON.
- **Storage** reads actual capacity/used/free space for the system/home
  filesystems, deduplicating filesystems on the same device. It opens Files
  and, on WSL, optionally the Windows storage page. It does not delete files.
- **About** separates the DevOs desktop version from the operating-system
  runtime, kernel, CPU, architecture and memory visible to Linux. A WSL
  development host is identified as such rather than presented as a native
  DevOs installation.

The native image includes wlr-randr, the pactl client and
power-profiles-daemon. Missing tools, services, hardware and
authorization failures are reported; no root helper or permissive policy is
installed. Display configuration uses wlr-randr's JSON inventory and compositor
test/apply protocol behind the DevOs interface, without launching wdisplays.

Validation: `npm run build`, `python3 tests/system.test.py`,
`gjs -m dist/system-settings-test.js` and
`d tools/test/system-smoke.dev --`. The smoke test opens all six pages in
an isolated session and captures real runtime data without changing display,
volume, power profile or host settings. The opt-in real display check is
`DEVOS_DISPLAY_INTEGRATION=1 gjs -m dist/display-live-test.js`; it changes scale
temporarily and tests preview, Keep, Revert and the independent watchdog. This
passed against the QEMU Bochs display. Physical monitors, multi-monitor changes
and power-profile authorization still need validation on hardware. The existing
exported USB image predates this UI and must be rebuilt to include it.

`DEVOS_AUDIO_INTEGRATION=1 gjs -m dist/audio-live-test.js` temporarily changes
the current output's volume/mute, checks default selection and restores the
original settings. This passed against PipeWire's Dummy Output in QEMU. UI
fixtures additionally cover microphone mute, output selection, application
volume/routing, service errors and cleanup. Physical sound and microphone
hardware still require device testing. The `pulseaudio-client-tools` package
contains pactl without requiring the PulseAudio server daemon.

Integrations follow [wlr output management](https://github.com/emersion/wlr-randr/blob/master/protocol/wlr-output-management-unstable-v1.xml) and
the [Power Profiles D-Bus API](https://upower.pages.freedesktop.org/power-profiles-daemon/gdbus-org.freedesktop.UPower.PowerProfiles.html).

## Battery Care Mode and Instant Full-Charge Mode (2026-10-25)

Settings > System > Power & battery has a "Battery Care Mode" card modelled on MyASUS, and the panel
quick-settings popover has an optional "Instant Full-Charge" switch.

- **Battery Care Mode** limits charging to 80% (`charge_control_end_threshold = 80`).
- **Instant Full-Charge Mode** sets the limit to 100% for 24 hours, then Battery Care Mode returns. It needs Battery Care Mode
  to be on (without it the battery already charges to 100%); turning Battery Care Mode on or off ends a running full charge.
- The checkbox "Display this switch in the panel…" is a per-user choice (`~/.config/dev-os/battery-care.conf`, `quick=0|1`,
  default shown). The panel switch only appears when the device supports a limit, Battery Care Mode is on (or a full
  charge is running) and the choice is on.

How it works:

| Piece | Role |
| --- | --- |
| `native/devos-battery-care` → `/usr/libexec/devos-battery-care` | POSIX sh, root. `get`, `apply`, `care on\|off`, `full on\|off`; JSON output. Writes only `charge_control_end_threshold` (80 or 100), only on `power_supply` entries with `type=Battery`, not `scope=Device`, not `present=0`, a safe name, and the attribute present. It reads the value back and fails if the driver did not keep it. If `charge_control_start_threshold` exists and is not below the new limit it is lowered by 5. `charge_behaviour` is read and reported, never written. |
| `bin/dev-os-battery-care` | User front end used by Settings and the panel: `get`, `care`, `full`, `quick`. Runs the root part through `pkexec`. |
| `data/polkit-1/actions/org.devos.battery.policy` | `org.devos.battery.care`: active local sessions need no password; the action is bound to `/usr/libexec/devos-battery-care`. |
| `/var/lib/devos/battery-care.conf` | State: `care=0\|1`, `full_until=<epoch>`. With no file, the firmware/driver limit is never touched. |
| `devos-battery-care.service`, `.timer`, `70-devos-battery-care.rules` | `apply` at boot, when a battery power supply appears (qcom_battmgr registers late), and every 10 minutes. A transient timer (`devos-battery-care-expire`) ends a full charge on time; after a reboot or suspend the boot service or the periodic timer catches up from the stored deadline. If the clock moves back by more than 24 hours the full charge is ended rather than extended. |

Unsupported hardware: when no battery exposes `charge_control_end_threshold` the card shows every control disabled with
"Not supported on this device" and the reason; nothing is faked and nothing is written. The latest UX3407NA log
(`devos-battery-report`: `qcom-battmgr-bat`, no threshold attributes listed) suggests this board may land in that state, but the
report does not list `charge_control_*` files, so whether the kernel's `qcom_battmgr` exposes them on this machine is unknown.
Check on the laptop: `ls /sys/class/power_supply/*/charge_control_* /sys/class/power_supply/*/charge_behaviour`, or
`sh /usr/libexec/devos-battery-care get`.

Validation: `python3 tests/battery-care.test.py` (helper against a fake sysfs, systemd stubs and a fake clock),
`node tools/build/build.ts` then `gjs -m dist/battery-care-ui-test.js` (card, interactions, unsupported state, panel switch),
`python3 tests/oe-shell-packaging.test.py` (install paths). **Not verified on real hardware:** that the UX3407NA kernel offers a charge limit,
that the pmic_glink firmware honours 80/100, the pkexec path with a real polkit agent, the udev/systemd units on a booted image,
and the transient 24-hour timer. The Live USB must be rebuilt to include this.

## Fan Profile

Settings > System > Power & battery has a "Fan Profile" card modelled on MyASUS: Performance, Standard and Whisper mode as a
radio group, a "Plugged-in" / "On battery" choice (the profile is saved per power source and the one for the current source is
applied; the card names the active source), the current fan speed when a hwmon `fan*_input` exists, the "[Fn] + [F]" hint on
asus-wmi machines, and "Power Mode Synchronization".

Backends, first match wins. Values come from a fixed table and are checked against what the kernel advertises; each write is read
back and a mismatch is an error. Modes the kernel does not offer are not shown, and fewer than two modes means unsupported.

| Backend | Node | Performance / Standard / Whisper |
| --- | --- | --- |
| `platform_profile` | `/sys/firmware/acpi/platform_profile` (+ `_choices`), else `/sys/class/platform-profile/platform-profile-*/{profile,choices}` | `performance` / `balanced` / `quiet` (else `low-power`) |
| `asus_wmi` | `/sys/devices/platform/asus-nb-wmi/throttle_thermal_policy` | `1` / `0` / `2` |
| `cpufreq` (emulated, labelled in the UI) | `scaling_governor` of every `cpufreq/policy*`, governors common to all policies | `performance` / `schedutil` (else `ondemand`) / `powersave`. Only the CPU policy changes; the fan keeps following the temperature. |

Power Mode Synchronization (on by default) also sets power-profiles-daemon (`powerprofilesctl`) to performance / balanced /
power-saver. It is offered only when the daemon lists at least two profiles; otherwise the switch is disabled with a reason.
The daemon is set first, then the fan profile is written, so the explicit fan profile wins.

| Piece | Role |
| --- | --- |
| `native/devos-fan-profile` → `/usr/libexec/devos-fan-profile` | POSIX sh, root. `get`, `apply`, `set ac\|battery\|both <mode>`, `sync on\|off`; JSON output. |
| `bin/dev-os-fan-profile` | User front end for Settings: `get`, `set`, `sync`; runs the root part through `pkexec`. |
| `data/polkit-1/actions/org.devos.fan.policy` | `org.devos.fan.profile`, same pattern as Battery Care (active local sessions, no password). |
| `/var/lib/devos/fan-profile.conf` | State: `ac=`, `battery=`, `sync=0\|1`. With no file, or no value for the current source, the firmware setting is never touched; unknown values are ignored. |
| `devos-fan-profile.service`, `71-devos-fan-profile.rules` | `apply` at boot and whenever a `power_supply` is added or changes (adapter plugged or unplugged). |

**This laptop (ASUS UX3407NA, Snapdragon X Elite):** the Live USB reports carry no `platform_profile`, `asus-nb-wmi`, hwmon or
cpufreq information at all, and the `asus,zenbook-a14-ux3407na-ec` driver in `native/kernel/asus-glymur-ec/` registers a hwmon
device with fan speed and temperatures only (read-only), so an `asus-wmi` or ACPI profile is not expected. If cpufreq governors
are present the card works in emulated mode (labelled); if not, it is shown disabled with the reason. Check on the laptop:
`sh /usr/libexec/devos-fan-profile get`, `ls /sys/firmware/acpi/platform_profile* /sys/class/platform-profile`,
`cat /sys/devices/system/cpu/cpufreq/policy*/scaling_available_governors`, `powerprofilesctl list`.

Validation: `python3 tests/fan-profile.test.py` (helper against a fake sysfs and a stub `powerprofilesctl`: every backend, precedence,
per-source apply, synchronization, corrupt state, rejected writes), `node tools/build/build.ts` then
`gjs -m dist/fan-profile-ui-test.js` (card text, radios, source tabs, synchronization, emulated and unsupported states),
`python3 tests/oe-shell-packaging.test.py`. **Not verified on real hardware:** which of the three backends (if any) the UX3407NA
kernel exposes, the pkexec path with a real polkit agent, the udev/systemd units on a booted image, power-profiles-daemon
behaviour on ARM, and that Whisper/Performance audibly change the fan (only the emulated CPU policy would be observable).
The `weather-windy` / `radio` icons are not in the Font Awesome mapping, so they use the GTK theme icons. The Live USB must be rebuilt.

## Display care: OLED Care, Flicker-Free Dimming, Splendid, Target Mode (2026-10-25)

Settings > System > Display shows five cards under the monitor settings, modelled on the MyASUS display pages. There is
no ASUS API on Linux, so each control is built from what labwc/wlroots and the shell really offer; what cannot be done
is shown disabled with the reason instead of being faked. All values are validated and saved by
`bin/dev-os-display-care` in `~/.config/devos/display-care.json` (no root, no polkit) and re-applied at every login.

| Card / control | How it works | Status |
|---|---|---|
| Pixel refresh (default On) | `dev-os-display-care serve` asks the compositor (ext-idle-notify-v1) for a 30 minute idle notification and creates `$XDG_RUNTIME_DIR/devos-pixel-refresh`; the shell extension `org.devos.displaycare` then draws a full-screen overlay cycling white, red, green, blue and black until any input. | Needs ext-idle-notify; disabled with a reason otherwise. |
| Pixel Shift (always on) | The panel content moves inside the panel by 0-2 px every 3 minutes (`panel-care.ts`); the work area never changes. | Shell-drawn. |
| Auto-hide panel (default Off) | The panel hides 1.5 s after the pointer leaves it (not while a menu or another shell window is open); a 2 px layer-shell strip on the screen edge brings it back. | Shell-drawn. |
| Panel transparency (default On) | CSS class `panel-translucent` (72 % opaque) or `panel-opaque`. | Shell-drawn. |
| Flicker-Free Dimming 0-100 | A software dimming level: the pixel values are scaled in the compositor's gamma table (25 % at 0, never black), so nothing pulses. It is separate from the kernel backlight (`dev-os-backlight`), which stays a real backlight. | wlr-gamma-control. |
| Splendid: Normal, Vivid, Manual, Eye Care | One gamma ramp per output. Manual shifts the white point from 3500 K to 9500 K (-50 to +50 around 6500 K); Eye Care lowers blue by 6 % per level and green by 1.2 % (level 5 = -30 % blue). Vivid is **only a contrast boost**: a gamma table is three 1-D curves and cannot raise saturation. | wlr-gamma-control. |
| E-Reading | Not offered. Black and white needs a colour matrix; a gamma table cannot remove colour. | Disabled with the reason. |
| Color Gamut | Only "Native". sRGB / DCI-P3 need colour management (ICC) that labwc and wlroots here do not have. | Disabled with the reason. |
| Reset to recommended settings | Restores Splendid Normal, temperature 0, Eye Care 3, gamut Native, dimming 100 and sets the backlight to 70 % (`dev-os-backlight set 70`); a missing backlight is reported. The OLED Care and Target Mode switches are left alone. | |
| Target Mode | A translucent black layer (60 %) on the work area with a hole where the active window is; it never takes input and never covers the panel. Not applied for fullscreen windows. | Shell-drawn, follows window geometry. |
| Adaptive Edge Brightness 0-4 (default 0 = off) | A fading dark band (8 % of the shorter screen side, 12-50 % strength) along all four edges, only while the battery is discharging (`/sys/class/power_supply`). Edge **brightness only**; contrast is not changed. | Shell-drawn. Disabled without a battery. |

While every Splendid and dimming value is at its default the helper holds no gamma control, so another gamma tool
(for example a night-light) keeps working. If another client owns the gamma of an output the helper leaves it alone
and logs it. `serve` runs as a child of the shell (a lock keeps it to one copy); `dev-os-display-care apply` restarts it.

Tests: `python3 tests/display-care.test.py` (state validation, ramp maths, a fake Wayland compositor with gamma and
idle protocols) and `gjs -m dist/display-care-ui-test.js` (all cards, queued requests, disabled states).

**Not verified on real hardware** (written and tested against a fake compositor and an offscreen GTK window only):
real labwc accepting the gamma ramps on the UX3407NA's eDP panel and its ramp size; the idle notification and the
screen saver on a real session; panel auto-hide with the hot edge, Pixel Shift margins; Target Mode following a
dragged window (the tracker reports geometry on configure, not during every drag frame); overlay stacking above
windows and below the panel on labwc; image quality and power effect of dimming on the OLED. The Live USB must be
rebuilt for the new helper, extension and CSS to ship.
