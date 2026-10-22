SUMMARY = "DevOs native Wayland desktop shell"
# The application repository has no declared redistribution license yet.
# This does not change the licenses of its third-party dependencies.
LICENSE = "CLOSED"
FILESEXTRAPATHS:prepend := "${DEVOS_PAYLOAD_DIR}:"
SRC_URI = "file://devos-runtime.tar.gz"
S = "${UNPACKDIR}/devos-runtime"
DEPENDS = "wayland wayland-native"
RDEPENDS:${PN} = "devlang gjs gtk+3 gtk-layer-shell libvte webkitgtk3 libsoup labwc dbus util-linux-setsid coreutils networkmanager-nmcli bash ca-certificates adwaita-icon-theme librsvg-gtk"
inherit pkgconfig
do_configure[noexec] = "1"
do_compile() {
    wayland-scanner client-header ${S}/native/protocols/wlr-foreign-toplevel-management-unstable-v1.xml ${B}/foreign-toplevel.h
    wayland-scanner private-code ${S}/native/protocols/wlr-foreign-toplevel-management-unstable-v1.xml ${B}/foreign-toplevel.c
    wayland-scanner client-header ${S}/native/protocols/devos-workspaces-v1.xml ${B}/devos-workspaces.h
    wayland-scanner private-code ${S}/native/protocols/devos-workspaces-v1.xml ${B}/devos-workspaces.c
    ${CC} ${CFLAGS} ${LDFLAGS} -std=c11 -I${B} ${S}/native/window-tracker.c ${B}/foreign-toplevel.c ${B}/devos-workspaces.c \
        $(pkg-config --cflags --libs wayland-client) -o ${B}/dev-os-window-tracker
}
do_install() {
    install -d ${D}${bindir} ${D}${datadir}/dev-os/native
    for directory in dist data config extensions lib; do
        cp -R --no-preserve=ownership ${S}/$directory ${D}${datadir}/dev-os/
    done
    install -d ${D}${prefix}/lib
    install -m0644 ${S}/lib/*.dev ${D}${prefix}/lib/
    for executable in ${S}/bin/*; do
        case "$executable" in *.ps1) continue ;; esac
        install -m0755 "$executable" ${D}${bindir}/
    done
    install -m0755 ${B}/dev-os-window-tracker ${D}${datadir}/dev-os/native/
    install -m0644 ${S}/native/*.dev ${D}${datadir}/dev-os/native/
    install -d ${D}${libexecdir} ${D}${datadir}/polkit-1/actions ${D}${localstatedir}/lib/devos
    install -m0755 ${S}/native/devos-account-admin ${D}${libexecdir}/devos-account-admin
    install -m0755 ${S}/native/devos-account-admin ${D}${libexecdir}/devos-account-setup
    install -m0755 ${S}/native/devos-pam-auth ${D}${libexecdir}/devos-pam-auth
    install -m0755 ${S}/native/devos-account-askpass ${D}${libexecdir}/devos-account-askpass
    install -m0755 ${S}/native/devos-app-store-admin ${D}${libexecdir}/devos-app-store-admin
    install -m0644 ${S}/data/polkit-1/actions/org.devos.appstore.policy ${D}${datadir}/polkit-1/actions/
    install -d ${D}${sysconfdir}/devos
    install -m0644 ${S}/config/app-store.json ${D}${sysconfdir}/devos/app-store.json
    install -m0644 ${S}/data/polkit-1/actions/org.devos.accounts.policy ${D}${datadir}/polkit-1/actions/
}
FILES:${PN} += "${prefix}/lib/*.dev ${datadir}/dev-os ${datadir}/polkit-1/actions ${localstatedir}/lib/devos ${sysconfdir}/devos"
CONFFILES:${PN} += "${sysconfdir}/devos/app-store.json"
