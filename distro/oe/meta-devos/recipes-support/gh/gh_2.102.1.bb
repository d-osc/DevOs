SUMMARY = "GitHub CLI"
DESCRIPTION = "Pinned upstream GitHub CLI release for repositories, releases and automation"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://gh-LICENSE;md5=5b6e7472988e8bc9eae127156113e555"
FILESEXTRAPATHS:prepend := "${DEVOS_PAYLOAD_DIR}:"
SRC_URI = "file://gh-arm64 file://gh-LICENSE file://gh-provenance.json"
S = "${UNPACKDIR}"
COMPATIBLE_HOST = "aarch64.*-linux"
PACKAGE_ARCH = "${TUNE_PKGARCH}"
inherit bin_package
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INSANE_SKIP:${PN} += "ldflags"
RDEPENDS:${PN} = "ca-certificates git"
do_install() {
    install -d ${D}${bindir} ${D}${datadir}/gh
    install -m0755 ${S}/gh-arm64 ${D}${bindir}/gh
    install -m0644 ${S}/gh-LICENSE ${D}${datadir}/gh/LICENSE
    install -m0644 ${S}/gh-provenance.json ${D}${datadir}/gh/provenance.json
}
FILES:${PN} += "${datadir}/gh"
