SUMMARY = "DevOs package manager CLI 0.7.0 (DevLang) from the pm-cli project"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://devospm-LICENSE;md5=d0ae0cc8f17a92e392eae349dd18c071"
FILESEXTRAPATHS:prepend := "${DEVOS_PAYLOAD_DIR}:"
SRC_URI = "file://devospm-cli.tar.gz;unpack=0 file://devospm-LICENSE file://devospm-provenance.json"
S = "${UNPACKDIR}"
# The CLI is DevLang source run by `d`; it shells out to the standard tools for archives and downloads.
inherit allarch
RDEPENDS:${PN} = "devlang util-linux-flock ca-certificates coreutils tar gzip xz zstd bzip2 cpio binutils curl findutils"
do_install() {
    install -d ${D}${bindir} ${D}${datadir}/devos-pm/cli
    tar -xzf ${UNPACKDIR}/devospm-cli.tar.gz -C ${D}${datadir}/devos-pm/cli --no-same-owner
    install -m0644 ${S}/devospm-provenance.json ${D}${datadir}/devos-pm/provenance.json
    install -m0644 ${S}/devospm-LICENSE ${D}${datadir}/devos-pm/LICENSE
    printf '#!/bin/sh\nDEV_LAUNCHER=/usr/bin/dev exec d /usr/share/devos-pm/cli/main.dev -- "$@"\n' > ${D}${bindir}/devospm
    chmod 0755 ${D}${bindir}/devospm
    ln -s devospm ${D}${bindir}/dev
}
FILES:${PN} += "${datadir}/devos-pm"
