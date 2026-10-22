SUMMARY = "DevLang runtime and native toolchain launcher (d, devrun, devc)"
DESCRIPTION = "Pinned DevLang release for running .dev scripts and building native programs"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://devlang-LICENSE;md5=91c4a1b076f529d5c1ecd410cf8bb114"
FILESEXTRAPATHS:prepend := "${DEVOS_PAYLOAD_DIR}:"
# devos-pm owns /usr/bin/dev; DevLang shebangs use "#!/usr/bin/env d".
SRC_URI = "file://devlang-arm64-d file://devlang-arm64-devrun file://devlang-arm64-devc file://devlang-LICENSE file://devlang-provenance.json"
S = "${UNPACKDIR}"
COMPATIBLE_HOST = "aarch64.*-linux"
PACKAGE_ARCH = "${TUNE_PKGARCH}"
inherit bin_package
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INSANE_SKIP:${PN} += "ldflags"
RDEPENDS:${PN} = "ca-certificates"
do_install() {
    install -d ${D}${bindir} ${D}${datadir}/devlang
    install -m0755 ${S}/devlang-arm64-d ${D}${bindir}/d
    install -m0755 ${S}/devlang-arm64-devrun ${D}${bindir}/devrun
    install -m0755 ${S}/devlang-arm64-devc ${D}${bindir}/devc
    install -m0644 ${S}/devlang-LICENSE ${D}${datadir}/devlang/LICENSE
    install -m0644 ${S}/devlang-provenance.json ${D}${datadir}/devlang/provenance.json
}
FILES:${PN} += "${datadir}/devlang"
