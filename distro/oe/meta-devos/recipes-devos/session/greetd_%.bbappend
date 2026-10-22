inherit systemd
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
SRC_URI += "file://devos-greetd.toml file://devos-greetd.pam"
SYSTEMD_SERVICE:${PN} = "greetd.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"
do_install:append() {
    install -m0644 ${UNPACKDIR}/devos-greetd.toml ${D}${sysconfdir}/greetd/config.toml
    install -d ${D}${sysconfdir}/pam.d
    install -m0644 ${UNPACKDIR}/devos-greetd.pam ${D}${sysconfdir}/pam.d/greetd
}
