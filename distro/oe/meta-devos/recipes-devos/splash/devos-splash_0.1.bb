SUMMARY = "Dev OS boot animation drawn on the framebuffer (nothing runs at shutdown), then a Wayland window until the shell is ready"
LICENSE = "CLOSED"
inherit systemd
SYSTEMD_SERVICE:${PN} = "devos-splash-system.service devos-splash-quit.service devos-splash-text.service"
SYSTEMD_AUTO_ENABLE = "enable"
SRC_URI = "file://devos-splash.c file://devos-splash-quit.service file://devos-splash-text.service file://devos-splash-system.service file://devos-splash-window.js"
S = "${UNPACKDIR}"
# The initramfs runs a static build of the same source (distro/usb/prepare.dev); this one serves the booted system.
do_compile() {
    ${CC} ${CFLAGS} ${LDFLAGS} ${UNPACKDIR}/devos-splash.c -o ${B}/devos-splash -lm
}
do_install() {
    install -d ${D}${bindir} ${D}${systemd_system_unitdir}
    install -m0755 ${B}/devos-splash ${D}${bindir}/devos-splash
    install -d ${D}${libexecdir}
    install -m0644 ${UNPACKDIR}/devos-splash-window.js ${D}${libexecdir}/devos-splash-window.js
    install -m0644 ${UNPACKDIR}/devos-splash-quit.service ${UNPACKDIR}/devos-splash-text.service ${UNPACKDIR}/devos-splash-system.service ${D}${systemd_system_unitdir}/
}
RDEPENDS:${PN} = "systemd gjs gtk+3"
