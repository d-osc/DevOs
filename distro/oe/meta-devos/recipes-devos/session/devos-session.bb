SUMMARY = "Local DevOs development session user and startup"
LICENSE = "CLOSED"
inherit useradd systemd
SYSTEMD_SERVICE:${PN} = "devos-zram.service devos-memory.service"
SYSTEMD_AUTO_ENABLE = "enable"
SRC_URI = "file://devos-desktop file://devos-greeter file://49-devos-admin.rules file://devos-profile.sh file://devos-zram.service file://devos-memory.service"
S = "${UNPACKDIR}"
USERADD_PACKAGES = "${PN}"
GROUPADD_PARAM:${PN} = "--system devos; --system wheel; --system devos-greeter"
USERADD_PARAM:${PN} = "--create-home --gid devos --shell /bin/sh devos; --system --create-home --home-dir /var/lib/devos-greeter --gid devos-greeter --groups video,render,seat --shell /sbin/nologin devos-greeter"
RDEPENDS:${PN} = "devos-shell greetd seatd dbus systemd shadow libpam libpam-runtime pam-plugin-exec pam-plugin-unix util-linux-zramctl util-linux-mkswap util-linux-swaponoff kmod"
do_install() {
    install -d ${D}${systemd_system_unitdir}
    install -m0644 ${UNPACKDIR}/devos-zram.service ${UNPACKDIR}/devos-memory.service ${D}${systemd_system_unitdir}/
    install -d ${D}${sysconfdir}/profile.d
    install -m0644 ${UNPACKDIR}/devos-profile.sh ${D}${sysconfdir}/profile.d/devos.sh
    install -d ${D}${bindir}
    install -m0755 ${UNPACKDIR}/devos-desktop ${D}${bindir}/devos-desktop
    install -m0755 ${UNPACKDIR}/devos-greeter ${D}${bindir}/devos-greeter
    install -d ${D}${sysconfdir}/polkit-1/rules.d
    install -m0644 ${UNPACKDIR}/49-devos-admin.rules ${D}${sysconfdir}/polkit-1/rules.d/
}
