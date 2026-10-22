# Lock screen

Press **Super + L**, choose **Lock** in the launcher, or run `dev-os-shell lock`.
Install the pinned native locker: `sudo sh tools/setup/bootstrap-lock.sh`.
Source installs and WSL bootstrap/run check this dependency with
`tools/setup/bootstrap-lock.sh`, installing Ubuntu 24.04's `swaylock=1.7.2-1build2`
with its PAM configuration and applying `apt-mark hold swaylock`.
Installation fails explicitly on Ubuntu 24.04 if that exact revision is unavailable.
On newer Ubuntu (including 26.04 ARM64), bootstrap uses the distribution's native
`swaylock` package and PAM configuration without downgrading or holding it.

The default `"lock": ["dev-os-lock"]` renders a Dev OS wallpaper using the configured
name, accent and background, and the current Linux user's display name. The native
indicator shows typing, verification, incorrect passwords, Caps Lock and keyboard
layout. Enter submits your Linux password; Escape clears input. Empty submissions
are ignored. All outputs are locked by swaylock.

Authentication uses the distribution's swaylock PAM configuration. Dev OS does not
receive passwords. The shell reports a successful lock only after swaylock's
compositor readiness notification, on swaylock versions supporting `--ready-fd`.
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
The Ubuntu 24.04 bootstrap retains its tested package pin.
