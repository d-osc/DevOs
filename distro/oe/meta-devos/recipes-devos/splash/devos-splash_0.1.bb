SUMMARY = "Dev OS boot animation drawn on the framebuffer (nothing runs at shutdown)"
LICENSE = "CLOSED"
inherit systemd
SYSTEMD_SERVICE:${PN} = "devos-splash-quit.service devos-splash-text.service"
SYSTEMD_AUTO_ENABLE = "enable"
SRC_URI = "file://devos-splash.c file://devos-splash-quit.service file://devos-splash-text.service"
S = "${UNPACKDIR}"
# The initramfs runs a static build of the same source (distro/usb/prepare.py); this one serves the booted system.
do_compile() {
    ${CC} ${CFLAGS} ${LDFLAGS} ${UNPACKDIR}/devos-splash.c -o ${B}/devos-splash -lm
}
do_install() {
    install -d ${D}${bindir} ${D}${systemd_system_unitdir}
    install -m0755 ${B}/devos-splash ${D}${bindir}/devos-splash
    install -m0644 ${UNPACKDIR}/devos-splash-quit.service ${UNPACKDIR}/devos-splash-text.service ${D}${systemd_system_unitdir}/
}
RDEPENDS:${PN} = "systemd"
