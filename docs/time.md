# Time settings

Settings → Time (or `dev-os-shell time`) shows a live clock, the current time
zone and network synchronization status. Refresh reads the service again.
The panel clock popup also has a **Time settings** button.
Search/select a time zone and click **Apply time zone**. The **Set time
automatically** switch enables/disables the system's NTP service. With automatic
time off, enter a local date (`YYYY-MM-DD`) and 24-hour time (`HH:MM`), then click
**Set date & time**. **Panel clock appearance** opens the existing Clock page.

The Python bridge uses the system `org.freedesktop.timedate1` D-Bus service.
SetTimezone, SetNTP and SetTime request normal interactive polkit authorization;
the shell does not run as root or install a permissive policy. The desktop
image enables systemd's timedated/timesyncd features and includes full tzdata.
An unavailable service or authorization failure is displayed, and unavailable
controls are disabled. Daylight-saving gaps/ambiguous manual times are rejected.

On WSL, Windows manages the system clock. Manual clock/NTP changes are disabled
in both the UI and backend, and **Open Windows time settings** opens the host
page only when clicked. The Linux-local time zone can be changed through
timedated when available and authorized. This page does not change the clock
display format; that remains under Clock.

Validation:

- `npm run build`
- `python3 tests/time.test.py` validates D-Bus method arguments, timestamp/time
  zone conversions, NTP and WSL guards, invalid dates and daylight-saving changes
  using a fake service. It does not change the host clock.
- `gjs -m dist/time-settings-test.js` tests native GTK UI actions, authorization
  errors, WSL/service-unavailable behavior and cleanup.
- `d tools/test/time-smoke.dev --` reads the real service and opens the Time
  page in a private session, saving a screenshot without changing time settings.

Native system-time mutation/authentication and NTP network synchronization
still need validation on the built DevOs image. The bridge follows
[systemd's timedate1 interface](https://github.com/systemd/systemd/blob/main/man/org.freedesktop.timedate1.xml).
