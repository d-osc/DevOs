# System settings

Settings → System groups the main device/system pages. Desktop, Date & time
and Language are entries inside System, rather than separate Preferences sidebar
items. System remains highlighted while those subpages are open. Direct commands are
`dev-os-shell system`, `display`, `sound`, `power`, `storage` and `about`.

- **Display** lists the current session's monitors, logical size, scale,
  refresh rate and primary indicator. On native Linux, Configure displays
  launches the bundled wdisplays companion for resolution/scaling/arrangement.
  On WSL it opens Windows display settings on explicit click, because the
  session's nested output does not describe the physical Windows screens.
- **Sound** controls the default audio output volume/mute through the same
  PipeWire/PulseAudio bridge used by the panel. Advanced settings opens the
  bundled pavucontrol on native Linux or Windows sound settings on WSL.
- **Power & battery** reads battery charge/state from Linux and exposes only
  profiles advertised by power-profiles-daemon. Native profile changes use
  its D-Bus ActiveProfile property with normal authorization. WSL directs
  profile changes to Windows power settings instead.
- **Storage** reads actual capacity/used/free space for the system/home
  filesystems, deduplicating filesystems on the same device. It opens Files
  and, on WSL, optionally the Windows storage page. It does not delete files.
- **About** separates the DevOs desktop version from the operating-system
  runtime, kernel, CPU, architecture and memory visible to Linux. A WSL
  development host is identified as such rather than presented as a native
  DevOs installation.

The native image includes wdisplays (pinned upstream source/checksum),
pavucontrol and power-profiles-daemon. Missing tools, services, hardware and
authorization failures are reported; no root helper or permissive policy is
installed. Display configuration is provided by the companion application;
the embedded page does not itself apply a monitor mode.

Validation: `npm run build`, `python3 tests/system.test.py`,
`gjs -m dist/system-settings-test.js` and
`d tools/test/system-smoke.dev --`. The smoke test opens all six pages in
an isolated session and captures real runtime data without changing display,
volume, power profile or host settings. Native physical-display changes and
power-profile authorization still need validation on the built image.

Integrations follow [wdisplays](https://github.com/artizirk/wdisplays) and
the [Power Profiles D-Bus API](https://upower.pages.freedesktop.org/power-profiles-daemon/gdbus-org.freedesktop.UPower.PowerProfiles.html).
