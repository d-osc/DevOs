# Lock screen

Press **Super + L**, choose **Lock** in the launcher, or run `dev-os-shell lock`.
Install the native locker: `sudo sh tools/setup/bootstrap-lock.sh`.
Source installs and WSL bootstrap/run check this dependency with
`tools/setup/bootstrap-lock.sh`, installing Ubuntu 24.04's `swaylock=1.7.2-1build2`
with its PAM configuration and applying `apt-mark hold swaylock`.
Installation fails explicitly on Ubuntu 24.04 if that exact revision is unavailable.
On newer Ubuntu (including 26.04 ARM64), bootstrap uses the distribution's native
`swaylock` package and PAM configuration without downgrading or holding it.

The default `"lock": ["dev-os-lock"]` renders a Dev OS wallpaper using the configured
name, the accent and background of the active Dark or Light theme, and the current Linux user's display name. The native
indicator shows typing, verification, incorrect passwords, Caps Lock and keyboard
layout. Enter submits your Linux password; Escape clears input. Empty submissions
are ignored. All outputs are locked by swaylock.

Authentication uses the distribution's swaylock PAM configuration. Dev OS does not
receive passwords. The shell reports a successful lock only after swaylock's
compositor readiness notification, on swaylock versions supporting `--ready-fd`.
The Dev OS image installs a screen-unlock PAM policy using `pam_unix`, instead
of console `login`'s `pam_securetty` check. Live root therefore unlocks with
`root`, while incorrect and empty passwords remain rejected. Installed users
unlock with their own password; the installed root account remains locked.
Ubuntu 24.04's swaylock 1.7.2 also works; it does not provide a readiness notification,
so the shell does not show a successful-lock message for this version.
The locker runs independently of GTK and remains active if the shell becomes unresponsive.
Ending the entire desktop session also ends its compositor and locker.
Keep the distribution's swaylock package installed, including its PAM configuration.
See [swaylock](https://github.com/swaywm/swaylock) for compositor requirements.

Existing custom `lock` command arrays still run unchanged. For an existing config,
set `lock` to `["dev-os-lock"]` in Settings to enable the themed screen.
The wallpaper contains no desktop screenshots and is removed after unlock.

Settings → Updates lists swaylock alongside Dev OS. Check for updates compares the
installed executable's version with the latest stable release from
[swaywm/swaylock releases](https://github.com/swaywm/swaylock/releases).
The entry displays the installed version; newer upstream releases are informational.
Use the distribution package manager to manage the locker and its PAM configuration.
The Ubuntu 24.04 bootstrap retains its tested package pin for PAM configuration. A locally built PAM-enabled swaylock 1.8.5 supplies the clock.
## Date and time

Sleep in the panel now opens a secure clock cover: solid black, with the time
and date centered. It keeps the system awake to display the clock. The first
keyboard press, touchpad movement, tap, or scroll reveals the password screen;
the first key is consumed and does not enter the password or start key repeat.
Authentication stays inside the same swaylock session-lock surface throughout.
Repeated lock requests restore the cover via SIGUSR2; that signal never unlocks.

The shell watches logind's lid state. Closing the lid locks first, then powers
off the internal eDP/LVDS/DSI panel with wlopm; opening restores the cover and
powers the panel on. External monitors retain their power state. The image's
logind lid action is `ignore` so it does not also suspend the machine. Real
suspend requested outside the panel still uses the existing lock-before-sleep
guard and hardware suspend policy. Native lid/panel behavior requires testing
on the laptop; simulated lid tests verify sequencing without suspending the host.

The Dev OS swaylock patch draws a 24-hour clock and the weekday, date, month and year above the user card. It uses the device's local time and refreshes when the minute changes, including while the shell is stopped. Refreshing never replaces the secure lock surface. The shell enables it with `DEV_OS_LOCK_CLOCK=1`; other swaylock users retain the upstream appearance.

The image applies the patch through the swaylock recipe. WSL setup builds the same PAM-enabled locker with `tools/setup/bootstrap-lock-clock.sh` and installs it in `/usr/local/bin`. A plain upstream swaylock has no clock support; rerun the setup script on existing WSL installations.

## Power buttons

The unlocked lock screen draws **Sleep**, **Restart** and **Shutdown** at the bottom
right, matching the login screen's buttons (patch `0003-devos-lock-power.patch`, drawn by
swaylock itself because no GTK runs behind the session lock). Click or tap with the
pointer; the black clock cover only wakes the screen on the first click.

- Sleep runs `systemctl suspend` at once. The session is already locked, so it
  resumes to the lock screen, and the panel's `SleepGuard` still locks before any
  suspend started elsewhere.
- Restart and Shutdown arm on the first click (the button reads "Confirm" in red) and
  run `systemctl reboot` / `poweroff` on the second; clicking anywhere else disarms.
- Actions go through logind with `--no-ask-password`, as the signed-in user. The
  lock screen cannot show an authentication prompt, so when other users are signed in
  and logind wants administrator authentication (`*-multiple-sessions`) the command
  fails and nothing happens. Unlike the greeter, no polkit rule widens this on purpose.

Verified: the patch applies on swaylock 1.8.5 with patches 0001/0002 and compiles
without warnings on Ubuntu/WSL; `tests/lock-power.test.py` checks the wiring. Not verified:
rendering and clicks under a real ext-session-lock compositor (labwc), touchscreen
input (only pointer events are handled), HiDPI scaling on the UX3407NA, the
multiple-sessions failure, and suspend/resume back to the lock screen. The patch was
not rebuilt through bitbake, and `tools/setup/bootstrap-lock-clock.sh` applies it to a
different upstream commit than the image does, so that path is untested too.
