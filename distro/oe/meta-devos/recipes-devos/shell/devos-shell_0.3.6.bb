SUMMARY = "DevOs native Wayland desktop shell"
# The application repository has no declared redistribution license yet.
# This does not change the licenses of its third-party dependencies.
LICENSE = "CLOSED"
FILESEXTRAPATHS:prepend := "${DEVOS_PAYLOAD_DIR}:"
SRC_URI = "file://devos-runtime.tar.gz"
S = "${UNPACKDIR}/devos-runtime"
DEPENDS = "wayland wayland-native"
RDEPENDS:${PN} = "gstreamer1.0 gstreamer1.0-plugins-base-videoconvertscale gstreamer1.0-plugins-base-audioconvert gstreamer1.0-plugins-base-audioresample gstreamer1.0-plugins-base-playback gstreamer1.0-plugins-good-gtk gstreamer1.0-plugins-good-video4linux2 gstreamer1.0-plugins-good-pulseaudio gstreamer1.0-plugins-good-level gstreamer1.0-plugins-good-jpeg gstreamer1.0-plugins-good-multifile gstreamer1.0-plugins-good-wavenc devlang gjs gtk+3 gtk-layer-shell libvte webkitgtk3 libsoup labwc wlr-randr pulseaudio-client-tools cups dbus util-linux-setsid coreutils networkmanager-nmcli networkmanager-openvpn util-linux-rfkill glib-networking gsettings-desktop-schemas dconf bash ca-certificates adwaita-icon-theme adwaita-icon-theme-cursors librsvg-gtk util-linux-sfdisk util-linux-blkid util-linux-lsblk util-linux-findmnt util-linux-findfs util-linux-blockdev util-linux-wipefs dosfstools e2fsprogs e2fsprogs-mke2fs efibootmgr tar shadow"
RDEPENDS:${PN} += "grim"
inherit pkgconfig mime
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
    install -d ${D}${bindir} ${D}${datadir}/dev-os/native ${D}${datadir}/dev-os/bin
    for directory in dist data config lib; do
        cp -R --no-preserve=ownership ${S}/$directory ${D}${datadir}/dev-os/
    done
    chmod 0755 ${D}${datadir}/dev-os/dist/native/taskmanager ${D}${datadir}/dev-os/dist/native/diskmanager ${D}${datadir}/dev-os/dist/native/installer
    chmod 0755 ${D}${datadir}/dev-os/dist/native/system-displaycare
    chmod 0755 ${D}${datadir}/dev-os/dist/native/system-panel ${D}${datadir}/dev-os/dist/native/panel ${D}${datadir}/dev-os/dist/native/panel-settings
    chmod 0755 ${D}${datadir}/dev-os/dist/native/boot-splash ${D}${datadir}/dev-os/dist/native/devos-bluetooth-agent
    install -d ${D}${datadir}/dev-os/src
    for directory in apps system extensions services; do
        cp -R --no-preserve=ownership ${S}/src/$directory ${D}${datadir}/dev-os/src/
    done
    install -d ${D}${prefix}/lib
    install -m0644 ${S}/lib/*.dev ${D}${prefix}/lib/
    for executable in ${S}/bin/*; do
        case "$executable" in *.ps1) continue ;; esac
        install -m0755 "$executable" ${D}${bindir}/
        install -m0755 "$executable" ${D}${datadir}/dev-os/bin/
    done
    install -m0755 ${B}/dev-os-window-tracker ${D}${datadir}/dev-os/native/
    install -m0644 ${S}/native/*.dev ${D}${datadir}/dev-os/native/
    install -d ${D}${libexecdir} ${D}${datadir}/polkit-1/actions ${D}${localstatedir}/lib/devos
    install -d ${D}${sysconfdir}/polkit-1/rules.d
    install -m0644 ${S}/data/polkit-1/rules.d/46-devos-base-apps.rules ${D}${sysconfdir}/polkit-1/rules.d/
    install -m0755 ${S}/native/devos-radio-admin ${D}${libexecdir}/devos-radio-admin
    install -m0755 ${S}/native/devos-battery-care ${D}${libexecdir}/devos-battery-care
    install -m0644 ${S}/data/polkit-1/actions/org.devos.battery.policy ${D}${datadir}/polkit-1/actions/
    install -m0755 ${S}/native/devos-fan-profile ${D}${libexecdir}/devos-fan-profile
    install -m0644 ${S}/data/polkit-1/actions/org.devos.fan.policy ${D}${datadir}/polkit-1/actions/
    install -m0755 ${S}/native/devos-swap ${D}${libexecdir}/devos-swap
    install -m0644 ${S}/data/polkit-1/actions/org.devos.swap.policy ${D}${datadir}/polkit-1/actions/
    install -m0755 ${S}/native/devos-system-update ${D}${libexecdir}/devos-system-update
    install -m0644 ${S}/data/polkit-1/actions/org.devos.system-update.policy ${D}${datadir}/polkit-1/actions/
    install -m0755 ${S}/native/devos-keyboard ${D}${libexecdir}/devos-keyboard
    install -m0644 ${S}/data/polkit-1/actions/org.devos.keyboard.policy ${D}${datadir}/polkit-1/actions/
    install -m0755 ${S}/native/devos-connectivity ${D}${libexecdir}/devos-connectivity
    install -m0644 ${S}/data/polkit-1/actions/org.devos.connectivity.policy ${D}${datadir}/polkit-1/actions/
    install -m0644 ${S}/data/polkit-1/actions/org.devos.radio.policy ${D}${datadir}/polkit-1/actions/
    install -m0755 ${S}/native/devos-account-admin ${D}${libexecdir}/devos-account-admin
    install -m0755 ${S}/native/devos-account-admin ${D}${libexecdir}/devos-account-setup
    install -m0755 ${S}/native/devos-pam-auth ${D}${libexecdir}/devos-pam-auth
    install -m0755 ${S}/native/devos-account-askpass ${D}${libexecdir}/devos-account-askpass
    install -m0755 ${S}/native/devos-app-store-admin ${D}${libexecdir}/devos-app-store-admin
    install -m0644 ${S}/data/polkit-1/actions/org.devos.appstore.policy ${D}${datadir}/polkit-1/actions/
    # wlroots/labwc look up the "default" cursor theme; without it the pointer is invisible.
    install -d ${D}${datadir}/icons/default
    echo "[Icon Theme]" > ${D}${datadir}/icons/default/index.theme
    echo "Inherits=Adwaita" >> ${D}${datadir}/icons/default/index.theme
    # .dpk needs its own shared-mime-info type; `inherit mime` runs update-mime-database on the target.
    install -d ${D}${datadir}/mime/packages
    install -m0644 ${S}/data/mime/packages/org.devos.package.xml ${D}${datadir}/mime/packages/
    install -d ${D}${sysconfdir}/devos
    install -m0644 ${S}/config/app-store.json ${D}${sysconfdir}/devos/app-store.json
    install -m0644 ${S}/data/polkit-1/actions/org.devos.accounts.policy ${D}${datadir}/polkit-1/actions/
}
FILES:${PN} += "${datadir}/mime/packages ${datadir}/icons/default ${prefix}/lib/*.dev ${datadir}/dev-os ${datadir}/polkit-1/actions ${localstatedir}/lib/devos ${sysconfdir}/devos ${sysconfdir}/polkit-1/rules.d/46-devos-base-apps.rules"
CONFFILES:${PN} += "${sysconfdir}/devos/app-store.json"
