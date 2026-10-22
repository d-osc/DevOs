# Bluetooth & Devices

Open Settings → Bluetooth & Devices. Linux shows BlueZ adapters and their real
power state, paired/discovered devices, connection state and visible USB/input
devices. Refresh reads state; Scan nearby requests a short discovery session.
Connect/disconnect use BlueZ; Forget requires confirmation and removes pairing
information. Pair… and Add a Bluetooth device open the system pairing dialog,
which handles PIN codes and passkey confirmation.

Mouse & touchpad, Keyboard and Printers & scanners open the corresponding native
system settings panels. These are clearly marked Linux or Windows. The native
pairing/settings dialogs currently require `gnome-control-center`.

On WSL, the Linux list only contains devices actually exposed to WSL. Windows
Settings handles the host's Bluetooth, mouse, keyboard and printers. Absence of
a Linux adapter is shown explicitly; it does not mean Bluetooth is off on the
Windows host. DevOs never fabricates a radio state or installs drivers here.

The Linux backend requires BlueZ, system D-Bus and Python 3 with PyGObject.
Requests run asynchronously with a timeout and are stopped when the page is
closed. Errors from the system remain visible on the page. Native hardware
pairing and reconnecting still require tests on a Linux machine with a radio.

Validation:

```sh
python3 tests/bluetooth-linux.test.py
npm run build
gjs -m dist/bluetooth-ui-test.js  # GTK-capable display/session
```

Backend reference: [BlueZ Adapter API](https://github.com/bluez/bluez/blob/master/doc/org.bluez.Adapter.rst)
and [Device API](https://github.com/bluez/bluez/blob/master/doc/org.bluez.Device.rst).
