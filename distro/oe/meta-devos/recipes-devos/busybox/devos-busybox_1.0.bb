SUMMARY = "Native DevLang busybox-cli from the DevOs repository, with a separate dash shell"
# The repository's busybox-cli has no declared license; dash's license is shipped.
LICENSE = "CLOSED"
FILESEXTRAPATHS:prepend := "${DEVOS_PAYLOAD_DIR}:"
SRC_URI = "file://devos-busybox.tar.gz file://busybox-applets.txt file://busybox-provenance.json"
S = "${UNPACKDIR}"
COMPATIBLE_HOST = "aarch64.*-linux"
PACKAGE_ARCH = "${TUNE_PKGARCH}"
inherit bin_package update-alternatives
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INSANE_SKIP:${PN} += "ldflags already-stripped"
PROVIDES += "busybox"
RPROVIDES:${PN} += "busybox busybox-hwclock"
RCONFLICTS:${PN} += "busybox busybox-hwclock"
RREPLACES:${PN} += "busybox busybox-hwclock"
ALTERNATIVE_PRIORITY = "40"

python __anonymous() {
    import os
    inventory = os.path.join(d.getVar('DEVOS_PAYLOAD_DIR'), 'busybox-applets.txt')
    with open(inventory) as stream:
        names = stream.read().split()
    # These names are owned directly by kbd, CUPS and the compression tools,
    # which do not register alternatives for them. Keep their full implementations.
    direct_tools = {'kbd_mode', 'setfont', 'setkeycodes', 'lpq', 'lpr', 'uncompress'}
    names = [name for name in names if name not in direct_tools]
    keys = {'[': 'lbracket', '[[': 'double-lbracket'}
    d.setVar('ALTERNATIVE:' + d.getVar('PN'), ' '.join(keys.get(name, name) for name in names))
    for name in names:
        key = keys.get(name, name)
        d.setVarFlag('ALTERNATIVE_LINK_NAME', key, d.getVar('bindir') + '/' + name)
        d.setVarFlag('ALTERNATIVE_TARGET', key, d.getVar('base_bindir') + '/busybox')
}
do_install() {
    install -d ${D}${base_bindir} ${D}/usr/libexec/devos ${D}${datadir}/devos-busybox ${D}${datadir}/licenses/dash
    install -m0755 ${S}/bin/busybox ${D}${base_bindir}/busybox
    install -m0755 ${S}/usr/libexec/devos/dash ${D}/usr/libexec/devos/dash
    install -m0644 ${S}/usr/share/licenses/dash/COPYING ${D}${datadir}/licenses/dash/COPYING
    install -m0644 ${S}/busybox-applets.txt ${D}${datadir}/devos-busybox/applets.txt
    install -m0644 ${S}/busybox-provenance.json ${D}${datadir}/devos-busybox/provenance.json
}
FILES:${PN} += "/usr/libexec/devos ${datadir}/devos-busybox ${datadir}/licenses/dash"
