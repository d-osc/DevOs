FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
SRC_URI:append = " file://0001-devos-lock-clock.patch file://0002-devos-lock-cover.patch file://0003-devos-lock-power.patch file://devos-swaylock.pam"
do_install:append() {
    install -d ${D}${sysconfdir}/pam.d
    install -m0644 ${UNPACKDIR}/devos-swaylock.pam ${D}${sysconfdir}/pam.d/swaylock
}
RDEPENDS:${PN}:append = " pam-plugin-unix"
