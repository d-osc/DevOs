SUMMARY = "DevOs package manager CLI from the local DevOsPM project"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://devospm-LICENSE;md5=d0ae0cc8f17a92e392eae349dd18c071"
FILESEXTRAPATHS:prepend := "${DEVOS_PAYLOAD_DIR}:"
SRC_URI = "file://devospm-arm64 file://devospm-LICENSE file://devospm-provenance.json"
S = "${UNPACKDIR}"
COMPATIBLE_HOST = "aarch64.*-linux"
PACKAGE_ARCH = "${TUNE_PKGARCH}"
inherit bin_package
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INSANE_SKIP:${PN} += "ldflags"
RDEPENDS:${PN} = "ca-certificates"
do_install() {
    install -d ${D}${bindir} ${D}${datadir}/devos-pm
    install -m0755 ${S}/devospm-arm64 ${D}${bindir}/devospm
    ln -s devospm ${D}${bindir}/dev
    install -m0644 ${S}/devospm-provenance.json ${D}${datadir}/devos-pm/provenance.json
}
FILES:${PN} += "${datadir}/devos-pm"
