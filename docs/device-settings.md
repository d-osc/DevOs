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
