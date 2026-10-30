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


## Connectivity: TaskFirst and WiFi SmartConnect

Settings > Network & Internet > Connectivity has two cards modelled on MyASUS (the fifth MyASUS TaskFirst option, "Screen Extend"
for GlideX, does not exist in Dev OS and is not offered).

**TaskFirst** (Off by default, Productivity and Communication, Multimedia streaming, Games). MyASUS has no hardware behind this
and neither does Dev OS: it is local egress prioritization, and the card says so. For every physical interface that is up the
root helper installs a two-band `prio` qdisc (handle `7a10:`) with `fq_codel` in each band and `flower` filters that send the
chosen kind of traffic into band 1: well-known TCP/UDP destination ports of the profile (web and cloud 80/443, mail, chat and
VoIP/video-call ports; HLS, QUIC, RTMP and RTSP; Steam, Xbox/PlayStation, Unreal, Blizzard and Minecraft ports) and DSCP
markings (EF; AF41/AF31/AF21; EF/CS5/AF41) for IPv4 and IPv6. Everything else is best effort in band 2. Limits, stated plainly:
it affects only what this computer sends, only while the uplink is queueing, it cannot add bandwidth or speed up downloads, and
port classification is a heuristic (apps on 443 look alike; traffic inside a VPN tunnel is not classified, because only physical
interfaces are shaped and tunnels hide the ports). No nftables or per-process classification is used.

Kernel and image: `devos-desktop.cfg` now enables `CONFIG_NET_SCH_PRIO=m`, `CONFIG_NET_SCH_FQ_CODEL=m` and
`CONFIG_NET_CLS_FLOWER=m` (the base config had priority queues, fq_codel and nftables off; HTB, cake and netfilter are not
needed), `devos-image.bb` installs `iproute2-tc` and `devos-session` depends on it. If `tc` or one of those modules is missing the
card is shown disabled with the reason and nothing is changed.

**WiFi SmartConnect** (Off by default). `devos-smartconnect.service` runs `devos-connectivity daemon` while the switch is on.
Every 20 s it reads the signal of the connected network without scanning. At 60 % (about -70 dBm) or better it does nothing. Below
that it rescans (at most once a minute), looks for other access points of the same network name, and switches only when one is
at least 20 percent (10 dBm) stronger on 3 scans in a row, no switch happened in the last 5 minutes and the interface is not
moving about 200 kB/s or more (a transfer or call). The switch is `nmcli device wifi connect <ssid> bssid <bssid> ifname <dev>`,
which activates the saved network on that access point without storing the BSSID. A failed switch keeps the connection and waits
the full interval. It polls through `nmcli` instead of subscribing to NetworkManager D-Bus signals. The last decision is shown
under the switch.

| Piece | Role |
| --- | --- |
| `native/devos-connectivity` -> `/usr/libexec/devos-connectivity` | POSIX sh, root. `get`, `apply`, `taskfirst off\|productivity\|streaming\|games`, `smartconnect on\|off`, `daemon`; JSON output. |
| `bin/dev-os-connectivity` | User front end for Settings; runs the root part through `pkexec`. |
| `data/polkit-1/actions/org.devos.connectivity.policy` | `org.devos.connectivity.change` (active local sessions, no password), same pattern as Fan Profile. |
| `/var/lib/devos/connectivity.conf` | State: `taskfirst=<profile>`, `smartconnect=0\|1`. Values are validated; unknown ones are treated as off. |
| `devos-connectivity.service`, `90-devos-connectivity` | `apply` at boot and from the NetworkManager dispatcher when an interface or lease changes. |
| `devos-smartconnect.service` | The SmartConnect daemon; started by the switch and at boot (it exits when disabled). |
| `src/apps/org.devos.settings/connectivity*.ts(x)` | The page (`network-category-connectivity`). |

Tests: `python3 tests/connectivity.test.py` (fake `tc` and `nmcli`, fixture scans and a fake clock: unsupported kernel, class
installation per profile, rollback, off/apply, privileges and invalid values, SmartConnect hysteresis, sustained scans, busy
link, switch interval, failed switch, disconnected) and `gjs -m dist/connectivity-ui-test.js` (build first). Both pass in WSL.

**Not verified on real hardware:** that the UX3407NA kernel loads `sch_prio`, `sch_fq_codel` and `cls_flower` and the QCC2072
driver's qdisc accepts the `prio` root (mac80211 drivers may bypass or replace the qdisc, in which case the filters have little
effect); that flower matches IPv6 traffic classes on this kernel; that the NetworkManager dispatcher runs in the image; the
pkexec path with a real polkit agent; real roaming between two access points of one network (the `nmcli` BSSID connect, signal
percentages and roam timing on the QCC2072); and the recipes (`distro/oe/build.sh --parse` could not run here: its prepare step
needs network access from WSL and timed out). The Live USB must be rebuilt to include this.
