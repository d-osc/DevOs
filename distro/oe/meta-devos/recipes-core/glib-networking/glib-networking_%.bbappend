# DevOs Proxy uses the standard per-user GSettings proxy backend.
PACKAGECONFIG:append = " gnomeproxy libproxy"
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
SRC_URI += "file://devos-proxy-resolver.patch"
