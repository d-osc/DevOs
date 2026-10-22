SUMMARY = "AudioReach topology for the ASUS UX3407NA Live image"
LICENSE = "BSD-3-Clause"
LIC_FILES_CHKSUM = "file://GLYMUR-ASUS-Zenbook-A14-UX3407NA.m4;beginline=1;endline=3;md5=23764ed22b5472844607d1625d36d3f2"
SRC_URI = "git://github.com/linux-msm/audioreach-topology.git;protocol=https;branch=main"
SRCREV = "993a17dcb672357998a463a73f120064d6c74f4f"
PV = "1.0+git"
inherit allarch
DEPENDS = "m4-native alsa-utils-native"
do_compile() {
    m4 -I ${S} ${S}/GLYMUR-ASUS-Zenbook-A14-UX3407NA.m4 >${B}/ux3407na.conf
    alsatplg -c ${B}/ux3407na.conf -o ${B}/GLYMUR-ASUS-Zenbook-A14-UX3407NA-tplg.bin
}
do_install() {
    install -d ${D}${nonarch_base_libdir}/firmware/qcom/glymur/ASUSTeK/UX3407NA
    install -m0644 ${B}/GLYMUR-ASUS-Zenbook-A14-UX3407NA-tplg.bin ${D}${nonarch_base_libdir}/firmware/qcom/glymur/
    install -m0644 ${B}/GLYMUR-ASUS-Zenbook-A14-UX3407NA-tplg.bin ${D}${nonarch_base_libdir}/firmware/qcom/glymur/ASUSTeK/UX3407NA/
}
FILES:${PN} = "${nonarch_base_libdir}/firmware"
