# Native network settings

Network & Internet now opens Wi-Fi, VPN, Mobile hotspot, Airplane mode, Proxy
and Advanced network settings inside DevOs. No category launches a host settings
application. Direct shell routes are `vpn`, `hotspot`, `airplane`, `proxy` and
`advanced`.

## VPN

Import WireGuard `.conf` and OpenVPN `.ovpn` files using the native file picker.
libnm and its OpenVPN plugin parse configurations in the DevLang worker. The
connection is stored with autoconnect disabled before it is added to
NetworkManager. Importing does not activate it. Connect, disconnect and confirmed
removal operate on an existing profile selected by UUID. Disconnect before
removal. User name and password can be provided when connecting OpenVPN; saved
credentials are used when those fields are empty. Interactive MFA and certificate
passphrase prompts are not implemented.

Passwords and private keys are never returned in profile snapshots or passed in
process arguments. The optional connection password uses a temporary 0600
`nmcli` password file, removed after the operation. Errors do not include command
diagnostics containing credentials. See the [libnm import API](https://networkmanager.dev/docs/libnm/latest/libnm-nm-conn-utils.html)
and [nmcli connection operations](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nmcli.html).

## Sharing and radios

Hotspot requires a managed Wi-Fi device advertising AP capability. Starting it
creates a WPA2 profile with IPv4 shared mode, IPv6 disabled and autoconnect off.
Failed activation deactivates and deletes the new profile. Stop deletes only
profiles carrying the DevOs hotspot marker. The selected Wi-Fi adapter leaves
its current network; use a separate upstream internet connection. Sharing relies
on the adapter/driver, NetworkManager, dnsmasq and kernel firewall support.

The profile uses the 2.4 GHz band (`band=bg`), the only band every radio can host
an access point on without a reported regulatory domain. The page suggests a random
12-character password (read from `/dev/urandom`, no look-alike characters) and shows
the name and password while the hotspot runs. When activation fails or times out,
the error names NetworkManager's device state reason (shared-start failure for
dnsmasq/NAT, supplicant failure, missing firmware) with its numeric code and points
to `devos-hotspot-report`. A Wi-Fi device that is managed but does not advertise AP
capability shows "Hotspot is not supported by this Wi-Fi hardware" with the driver
name instead of an empty page, and the backend refuses the request with the same
text. `devos-hotspot-report` (see [live-usb.md](live-usb.md)) checks each layer on
the device and can try a temporary hotspot.

Airplane mode reads rfkill soft and hard blocks. A narrowly scoped, root-owned
DevLang service changes blocks after polkit administrator authentication. It
stores the previous state under `/var/lib/devos` with a lock and restores previous
software blocks when disabled. Physical switches cannot be overridden. Missing
radio hardware disables the control. No helper accepts arbitrary command names
or radio arguments from the caller.

## Proxy and adapter details

Proxy supports direct access, PAC URLs, separate HTTP/HTTPS/SOCKS servers, a shared
HTTP proxy, HTTP authentication and bypass hosts. Preferences use per-user
`org.gnome.system.proxy` GSettings. glib-networking's GSettings resolver is enabled
for the DevOS desktop by an OE patch; DevOs does not identify itself as GNOME.
The session selects that resolver. Supported GIO/libsoup apps can use these
preferences; apps with their own networking configuration may need separate
configuration. See [GIO ProxyResolver](https://gnome.pages.gitlab.gnome.org/gtk/gio/iface.ProxyResolver.html).

Advanced settings shows adapter state, MAC address, driver, MTU, IPv4/IPv6
addresses, gateways, DNS and NetworkManager connectivity. Connect/disconnect is
confirmed and limited to managed Ethernet/Wi-Fi devices. It does not delete
saved networks or reset the system network configuration.

## Validation

Private D-Bus fixtures exercise NetworkManager snapshots, AP capabilities,
hotspot activation/failure cleanup and validated connection actions. Radio tests
use a private filesystem and fake rfkill implementation. GTK tests exercise all
five pages, confirmations, masked passwords, disabled hardware states, proxy
validation and actual GIO proxy lookup using a memory preferences backend.
`network-proxy-live-test` is opt-in and restores original preferences.

QEMU tests can validate Ethernet details/actions, VPN import and virtual
interfaces, and persistent proxy resolution. A QEMU guest without a wireless
adapter cannot validate physical Wi-Fi AP operation or physical radio blocks.
A WireGuard interface becoming active does not prove a peer handshake or
working access to a VPN provider.

On 2026-10-22, QEMU passed WireGuard/OpenVPN imports with autoconnect off,
WireGuard virtual interface connect/disconnect/removal, Ethernet disconnect and
reconnect with DHCP/DNS, and manual proxy, bypass and PAC download/JavaScript
selection. Proxy preferences were restored and test VPN profiles removed.
Physical Wi-Fi hotspot/radio operation and VPN peer handshakes remain untested.
The private D-Bus fixture also checks the 2.4 GHz band, the failure text built from
the device state reason, and the unsupported-hardware refusal; the GTK test checks
the suggested password and the unsupported-adapter page.
