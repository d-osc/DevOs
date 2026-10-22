# Linux users and GitHub OS login

The DevOs image uses greetd and PAM to authenticate a selected Linux user and
start the desktop with that user's UID, home directory, permissions and settings.
The old automatic shared-user desktop is replaced by a graphical greeter.

On a new DevOs image, choose Add user to create the first administrator with a
local password of at least 4 characters. Initial setup is allowed only on
`ID=devos`, before any personal users exist; creating the first account seals this
path. The administrator joins `wheel`. Polkit uses wheel members for subsequent
administrator authentication. Additional users are ordinary users.

Settings → Accounts → Add user creates an actual Linux user through the installed
root-owned polkit helper. Each home is explicitly `/home/<username>` with mode
0700. Passwords go to `chpasswd` through stdin, never command-line arguments.
Systemd/logind grants access to active-seat devices. The existing `devos` user is
the separate public Guest account, not an alias for the last personal user.
Guest home contents persist; Guest is not an ephemeral or private identity.

New user offers **GitHub** and **Guest / Local account**. The GitHub path first
completes Device Flow, then displays the verified GitHub username as the OS
username and asks for an OS password. The enrollment token stays in the helper's
memory for at most ten minutes; it is not sent to GTK or saved. The privileged
creator verifies GitHub again, derives the username itself and creates the user
and UID binding together. An unverified form cannot claim a GitHub username.
Linux usernames are lowercase; names starting with digits or reserved names get
`gh-`, and names exceeding 31 characters are shortened. Existing usernames and
duplicate GitHub IDs are rejected without overwriting users.

Guest / Local creates a named local user with its own password and private home,
without an online account. This differs from the public Continue as Guest option.
The login screen lists existing OS users and identifies linked GitHub profiles;
the list persists through the Linux account database and root-owned bindings.

To link GitHub to an existing local user instead:

1. Create a personal Linux user and sign in with its local password.
2. Open Accounts and select Link GitHub to this Linux user.
3. Authorize the GitHub device code in your browser and approve the administrator
   prompt for linking. The privileged helper independently verifies `/user`.
4. Sign out of the desktop, select the same Linux user, and choose Sign in with
   linked GitHub. A fresh browser/device authorization is required for each login.

Bindings use immutable numeric GitHub IDs plus the Linux UID, not GitHub display
names. A GitHub ID cannot be linked to two users. Root, Guest and greeter accounts
cannot be linked. Reusing a deleted username with another UID does not inherit
the old binding. `Unlink` removes the OS-login binding after admin authentication;
online `Sign out` alone does not remove it. A local password remains available for
offline login and is required by the existing PAM screen lock.

`/var/lib/devos/accounts.json` is root-owned and writable only by root. It stores
public account IDs, not OAuth tokens. The greeter keeps pending OAuth credentials
in memory, then sends a fresh token through greetd's private socket to PAM.
`pam_exec` runs the installed root-owned verifier, which calls GitHub again and
checks the selected user's numeric binding. PAM account and session checks still
run. A failed verification never authorizes a session. No GitHub token is saved
to disk or returned to GTK. Device codes can also be authorized on another device.

The bundled public OAuth App client ID lives in `config/accounts.json`. Client ID
and configuration controls are hidden from the UI. Developer overrides for the
desktop linking flow use `$XDG_CONFIG_HOME/dev-os/accounts.json` or
`DEV_OS_GITHUB_CLIENT_ID`; the image greeter uses the bundled registration. Enable
Device Flow for this OAuth App. See [GitHub device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).

## WSL development

`dev.ps1 run` installs account-management helpers and the polkit authentication
agent, and stages the native account module. It does **not** replace WSL's PAM,
login manager or default user. Accounts can create actual WSL Linux users and
link the current personal user to GitHub after administrator approval. Restart
DevOs to run the new code. Existing online-only identity from earlier versions
is not trusted as an OS binding: authorize GitHub again to link it.

WSL processes may not belong to a logind session, so the GNOME polkit agent can
exit before showing a prompt. WSL account operations instead use `sudo -A` with
the root-owned `devos-account-askpass` GTK dialog. Enter the existing WSL sudo
administrator's password in that dialog, not the new user's password. Native
DevOs continues to use polkit. The password minimum for new OS users is four
characters in both frontend and privileged validation.

A nested compositor cannot change the UID of its parent WSL session. To run
DevOs as a newly created WSL user, launch it with `wsl -d Ubuntu -u <username>`
and an accessible DevOs runtime. Normal user switching belongs to the image's
greetd session. The WSL welcome chooser still starts the current WSL user.

Accounts now offers Switch to this user, and the panel has a profile button for
Switch OS user. On the image, confirmation signs out and returns to greetd;
save work before confirming because applications close. On WSL, confirmation
launches `dev.ps1 run -User <username>` through the Windows host in a hidden
PowerShell process. It creates a separate runtime owned by that Linux UID and
starts a new desktop with its own home and XDG runtime. The old desktop stays
open; lock it through the session menu if needed. WSL uses the current Windows
account's existing authority to start a Linux user, as `wsl.exe -u` normally does.
Launch logs live in `build/user-sessions/<username>.log` and `.error.log`.
Restart via `dev.ps1 run` to supply the Windows project path to the shell.

## Validation

`tests/os-accounts.test.py` covers UID binding, fresh identity checks, root/Guest
restrictions, duplicate identities, command validation and private homes.
`tests/greeter.test.py` exercises greetd IPC with fragmented reads, rejects
session creation after failed PAM authentication and checks verified enrollment.
`dist/os-login-test.js` checks the user picker, password privacy, both account
types and GitHub verification before OS password setup.
`distro/oe/build.sh --parse` checks the image package dependency graph. These do
not replace booting the new image and testing greetd/PAM, first-user provisioning,
logout/user switching and live GitHub authorization on the target.

`sudo d tools/test/os-accounts-integration.dev --` creates a private mount
namespace with separate copies of `/etc`, `/home` and the account registry. It
tests actual `useradd`, `chpasswd`, home permissions and the installed PAM
verifier, including successful local and Guest login and rejection of incorrect
credentials. It leaves the host's users, password database and PAM configuration
unchanged. The test stages the current DevLang services itself inside that namespace.

The desktop helpers `dev-os-accounts` and `dev-os-greeter-backend` now run with
DevLang `d` (0.5.5 or newer). Their shared implementation is in `lib/accounts.dev`
and `lib/greeter.dev`; greetd framing uses libc Unix sockets. The root-owned
account administration and PAM verifier in `native/` also use DevLang, with
absolute `/usr/bin/d` launchers and root-owned imports under `/usr/share/dev-os`.
OAuth tokens and passwords do not enter command arguments or UI replies.

The WSL service installer requires a root-owned DevLang 0.5.5+ runtime at
`/usr/bin/d` (and its companion `devrun`). The image recipe installs these paths.
`native/privileged.dev` reads configuration through descriptors with `O_NOFOLLOW`,
checks ownership/mode using the portable Linux `statx` layout, and serializes
account updates with `flock` and atomic, fsynced registry replacement.

Native regression commands (Python is only the external test harness):

```sh
python3 tests/os-accounts.test.py
python3 tests/app-store.test.py
sudo env DEVLANG_BIN="$(command -v d)" python3 tests/native-services.test.py
sudo d tools/test/os-accounts-integration.dev
d tools/test/native-services-smoke.dev
```

The account integration stages the current sources and launchers in its private
namespace; no production helper installation is needed beyond the empty mount
points `/usr/share/dev-os`, `/usr/libexec` and `/var/lib/devos`. The Store endpoint
test uses a private opkg executable and never installs host packages. The askpass
smoke enters a synthetic password and cancels a second dialog in headless Wayland.

Run `python3 tests/accounts.test.py` and `python3 tests/greeter.test.py` with `d`
on PATH. The tests execute DevLang against local HTTP and Unix-socket fixtures;
they do not create host users or start an actual desktop session.
