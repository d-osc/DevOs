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
