# Wi-Fi in Dev OS on WSL2

Open **Settings → Network & Internet → Wi-Fi**, or choose **Wi-Fi → Networks** in the panel's Quick
settings. The page shows Windows' available named networks, signal strength,
security, saved profiles and the connected network. **Refresh** requests a new
Windows scan and reads the latest scan cache; because scanning is asynchronous,
refresh again after a moment if a newly available network has not appeared.

**Connect** requests a connection using an existing Windows profile. The page
reports that the request was sent; refresh to verify the connected network.
For new passwords, hidden networks, forgetting profiles or changing the radio
state, use **Open Windows Wi-Fi settings**. Dev OS never retrieves saved Wi-Fi
passwords and does not create credentials or change radio state automatically.

Windows owns the physical adapter in WSL2. This feature uses the Native Wi-Fi
API through Windows PowerShell; installing a Linux Wi-Fi driver inside WSL does
not expose that adapter. Windows interop must be enabled. If Windows denies
network enumeration, the page shows the error and explains the Location privacy
permission; it does not change privacy settings automatically.

On native Linux and Live USB, this page uses `dev-os-network-linux` with
NetworkManager. New Personal Wi-Fi connections are created directly over
D-Bus from DevOs Settings, using a masked password form; credentials pass over
stdin/D-Bus rather than command arguments. Failed new connections are removed.
Open, WPA/WPA2 Personal, WPA3 SAE and OWE networks are supported. Enterprise and
legacy authentication need additional native UI; no external settings window is
launched. The page includes Wi-Fi radio and disconnect controls. Other native
network pages are disabled until implemented. Windows settings remain a WSL
host integration only.
A source checkout resolves the helper in its own `bin/`; an
installed desktop resolves it from PATH (`/usr/bin` in the Live image). Empty,
malformed, failed and timed-out helper responses show a readable diagnostic
instead of exposing a JSON parser exception. The image includes
`wireless-regdb-static` for the kernel's signed regulatory database. Live USB
also stages that database and signature in initramfs for early cfg80211 probes;
no country code is forced. Seeing `wlan0` confirms adapter enumeration, but scanning and
connection still require testing on the physical machine.

CLI shortcut: `bin/dev-os-shell wifi` from a terminal in the Dev OS session.
After updating a source checkout, close and reopen Dev OS to load the new
immutable staged runtime.

Tests:

```sh
gjs -m dist/wifi-test.js
# Read-only integration test against the real Windows WLAN API:
DEV_OS_TEST_HOST_WIFI=1 gjs -m dist/wifi-test.js
```

The desktop smoke suite tests the UI and backend actions using fixtures; it does
not switch the host's live Wi-Fi connection.

References: [WlanGetAvailableNetworkList](https://learn.microsoft.com/windows/win32/api/wlanapi/nf-wlanapi-wlangetavailablenetworklist)
and [Windows Wi-Fi location permissions](https://learn.microsoft.com/windows/win32/nativewifi/wi-fi-access-location-changes).

The Linux bridge is implemented in DevLang (`d` 0.5.5+). A DevLang worker loads
the system GIO shared library explicitly and calls NetworkManager over D-Bus;
new credentials remain in memory. Python GI/libnm is not used by this bridge.
`nmcli` is still required for saved-profile activation, radio and disconnect.
Run `python3 tests/network-linux.test.py` for a private D-Bus service fixture
that checks Unicode SSIDs, activation and failed-connection cleanup without
changing the host network. Its Python harness requires PyGObject and dbus-daemon.
