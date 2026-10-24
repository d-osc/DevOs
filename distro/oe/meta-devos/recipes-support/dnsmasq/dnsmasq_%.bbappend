# NetworkManager starts a per-hotspot dnsmasq bound to the shared interface.
# A system-wide instance binds :53 first and makes sharing fail with EADDRINUSE.
SYSTEMD_AUTO_ENABLE = "disable"
INITSCRIPT_PARAMS = "stop 20 0 1 2 3 4 5 6 ."
