SUMMARY = "Node Version Manager: users install and switch Node.js versions themselves"
HOMEPAGE = "https://github.com/nvm-sh/nvm"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://LICENSE.md;md5=d9eae036a0f5820f88ab3fa289a9016b"
SRC_URI = "git://github.com/nvm-sh/nvm.git;protocol=https;branch=master;tag=v${PV}            file://devos-nvm.sh"
SRCREV = "a885b885fef16fac4bc544188fb25e9e37ae83e8"

do_compile[noexec] = "1"

do_install() {
    install -d ${D}${datadir}/nvm
    install -m0644 ${S}/nvm.sh ${S}/bash_completion ${D}${datadir}/nvm/
    install -m0755 ${S}/nvm-exec ${D}${datadir}/nvm/
    install -d ${D}${sysconfdir}/profile.d
    install -m0644 ${UNPACKDIR}/devos-nvm.sh ${D}${sysconfdir}/profile.d/nvm.sh
}

FILES:${PN} = "${datadir}/nvm ${sysconfdir}/profile.d/nvm.sh"
# nvm downloads official linux-arm64 builds, so no compiler is required.
RDEPENDS:${PN} = "bash curl git ca-certificates tar gzip xz coreutils findutils grep sed gawk"
