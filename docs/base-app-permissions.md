# Base app permissions

Native Base apps run with the signed-in user's access to files, network and
session devices. They are not given a separate root desktop process.

The image installs `46-devos-base-apps.rules` for system controls. A local,
active administrator (`wheel`, or root) may use the named DevOs account, Store,
update and hardware helpers without another administrator-password prompt.
The same policy covers NetworkManager, UDisks, timedate, hostname, login/power
and BlueZ authorization. Helper actions must match their installed executable
path. Arbitrary pkexec/sudo commands and generic systemd unit management retain
their normal authorization.

Polkit authorizes an account, not a GUI application's identity. Other processes
of that administrator can invoke the same approved operations; this policy is
not a sandbox boundary between Base apps and installed applications. Guest,
inactive and remote sessions retain their normal authorization. Webpage
camera/microphone requests are separate from native app permissions.

This change takes effect after installing the updated OS policy/image. Building
the JavaScript bundles alone does not change permissions on an installed laptop.

Validation: `node tests/base-app-permissions.test.mjs`.
