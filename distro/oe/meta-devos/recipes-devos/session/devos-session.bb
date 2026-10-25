SUMMARY = "Local DevOs development session user and startup"
LICENSE = "CLOSED"
inherit useradd systemd
SYSTEMD_SERVICE:${PN} = "devos-zram.service devos-memory.service devos-battery-care.service devos-battery-care.timer devos-fan-profile.service devos-keyboard.service devos-connectivity.service devos-smartconnect.service"
SYSTEMD_AUTO_ENABLE = "enable"
SRC_URI = "file://devos-desktop file://devos-greeter file://47-devos-time.rules file://48-devos-network.rules file://49-devos-admin.rules file://10-devos-wheel.sudoers file://devos-profile.sh file://devos-zram.service file://devos-memory.service file://devos-battery-care.service file://devos-battery-care.timer file://70-devos-battery-care.rules file://devos-fan-profile.service file://71-devos-fan-profile.rules file://devos-connectivity.service file://devos-smartconnect.service file://90-devos-connectivity file://devos-microphone.service file://devos-speaker.service file://devos-keyboard-backlight.service file://devos-keyboard.service file://devos-touchpad-gestures.service file://72-devos-touchpad.rules file://devos-sleep.conf file://devos-logind.conf"
S = "${UNPACKDIR}"
USERADD_PACKAGES = "${PN}"
GROUPADD_PARAM:${PN} = "--system devos; --system wheel; --system netdev; --system devos-greeter"
USERADD_PARAM:${PN} = "--create-home --gid devos --shell /bin/sh devos; --system --create-home --home-dir /var/lib/devos-greeter --gid devos-greeter --groups video,render,seat --shell /sbin/nologin devos-greeter"
RDEPENDS:${PN} = "devos-shell sudo greetd seatd dbus systemd shadow libpam libpam-runtime pam-plugin-exec pam-plugin-unix util-linux-zramctl util-linux-mkswap util-linux-swaponoff kmod iproute2-tc"
do_install() {
    install -d ${D}${systemd_system_unitdir}
    install -m0644 ${UNPACKDIR}/devos-zram.service ${UNPACKDIR}/devos-memory.service ${UNPACKDIR}/devos-battery-care.service ${UNPACKDIR}/devos-battery-care.timer ${UNPACKDIR}/devos-fan-profile.service ${UNPACKDIR}/devos-keyboard.service ${UNPACKDIR}/devos-connectivity.service ${UNPACKDIR}/devos-smartconnect.service ${D}${systemd_system_unitdir}/
    # Re-apply TaskFirst whenever NetworkManager brings an interface up or down.
    install -d ${D}${sysconfdir}/NetworkManager/dispatcher.d
    install -m0755 ${UNPACKDIR}/90-devos-connectivity ${D}${sysconfdir}/NetworkManager/dispatcher.d/90-devos-connectivity
    # Per-user noise canceling filter; started at login by devos-desktop and enabled for any other user manager.
    install -d ${D}${systemd_user_unitdir}/default.target.wants
    install -m0644 ${UNPACKDIR}/devos-microphone.service ${D}${systemd_user_unitdir}/
    install -m0644 ${UNPACKDIR}/devos-speaker.service ${D}${systemd_user_unitdir}/
    install -m0644 ${UNPACKDIR}/devos-keyboard-backlight.service ${D}${systemd_user_unitdir}/
    ln -sf ../devos-keyboard-backlight.service ${D}${systemd_user_unitdir}/default.target.wants/devos-keyboard-backlight.service
    install -m0644 ${UNPACKDIR}/devos-touchpad-gestures.service ${D}${systemd_user_unitdir}/
    ln -sf ../devos-touchpad-gestures.service ${D}${systemd_user_unitdir}/default.target.wants/devos-touchpad-gestures.service
    ln -sf ../devos-speaker.service ${D}${systemd_user_unitdir}/default.target.wants/devos-speaker.service
    ln -sf ../devos-microphone.service ${D}${systemd_user_unitdir}/default.target.wants/devos-microphone.service
    install -d ${D}${sysconfdir}/udev/rules.d
    install -m0644 ${UNPACKDIR}/70-devos-battery-care.rules ${UNPACKDIR}/71-devos-fan-profile.rules ${UNPACKDIR}/72-devos-touchpad.rules ${D}${sysconfdir}/udev/rules.d/
    install -d ${D}${sysconfdir}/profile.d
    install -m0644 ${UNPACKDIR}/devos-profile.sh ${D}${sysconfdir}/profile.d/devos.sh
    install -d ${D}${bindir}
    install -m0755 ${UNPACKDIR}/devos-desktop ${D}${bindir}/devos-desktop
    install -m0755 ${UNPACKDIR}/devos-greeter ${D}${bindir}/devos-greeter
    install -d ${D}${sysconfdir}/systemd/sleep.conf.d ${D}${sysconfdir}/systemd/logind.conf.d
    install -m0644 ${UNPACKDIR}/devos-sleep.conf ${D}${sysconfdir}/systemd/sleep.conf.d/10-devos.conf
    install -m0644 ${UNPACKDIR}/devos-logind.conf ${D}${sysconfdir}/systemd/logind.conf.d/10-devos-power.conf
    install -d ${D}${sysconfdir}/polkit-1/rules.d
    install -m0644 ${UNPACKDIR}/47-devos-time.rules ${UNPACKDIR}/48-devos-network.rules ${UNPACKDIR}/49-devos-admin.rules ${D}${sysconfdir}/polkit-1/rules.d/
    install -d -m0750 ${D}${sysconfdir}/sudoers.d
    install -m0440 ${UNPACKDIR}/10-devos-wheel.sudoers ${D}${sysconfdir}/sudoers.d/10-devos-wheel
}
FILES:${PN} += "${systemd_user_unitdir}"
