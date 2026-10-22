SUMMARY = "Selected Qualcomm wireless firmware for DevOs X2 Live hardware tests"
LICENSE = "Firmware-qualcommAthos_ath10k & Firmware-qcom"
NO_GENERIC_LICENSE[Firmware-qcom] = "LICENSE.qcom"
NO_GENERIC_LICENSE[Firmware-qualcommAthos_ath10k] = "LICENSE.QualcommAtheros_ath10k"
LIC_FILES_CHKSUM = "file://LICENSE.QualcommAtheros_ath10k;md5=cb42b686ee5f5cb890275e4321db60a8 file://LICENSE.qcom;md5=164e3362a538eb11d3ac51e8e134294b"
inherit allarch
# The ELF .mbn runs on the GPU secure processor, not the target userspace ABI.
INSANE_SKIP:${PN} += "arch"
FIRMWARE_REV = "9a80a04181713da7f8187ec928c15160137f3262"
S = "${UNPACKDIR}"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/LICENSES/LICENSE.QualcommAtheros_ath10k;name=fw0;downloadfilename=LICENSE.QualcommAtheros_ath10k"
SRC_URI[fw0.sha256sum] = "337a55102138d7baa143ee4a4c6c91693e0113fece35d380b2a12109e8c23b3f"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/ath12k/QCC2072/hw1.0/board-2.bin;name=fw1;downloadfilename=board-2.bin"
SRC_URI[fw1.sha256sum] = "6880d8e6d51292f6bb5f855965b4c2d1bca3fa0d8a70e68bd693d1e73ff43bf1"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/ath12k/QCC2072/hw1.0/firmware-2.bin;name=fw2;downloadfilename=firmware-2.bin"
SRC_URI[fw2.sha256sum] = "4c6a1be1f5bfad76319755ff76904abb21c4c7ece5293cc5f33a20b1f4c35254"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/ath12k/QCC2072/hw1.0/Notice.txt;name=fw3;downloadfilename=Notice.txt"
SRC_URI[fw3.sha256sum] = "515bf4c9d620a87458e4447fe01a0e9bc384d1c3e0037cc4c3d2037b1ff25525"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/qca/ornbtfw11.tlv;name=fw4;downloadfilename=ornbtfw11.tlv"
SRC_URI[fw4.sha256sum] = "a34ddeb92f34ff69c4b3dfcf65214771146db035712e8b2a2583a22fc876ad8b"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/qca/ornnv11.bin;name=fw5;downloadfilename=ornnv11.bin"
SRC_URI[fw5.sha256sum] = "803914dd9823ec5c1cf664e8b36695553a2a718cb998eb749e03b7efeec1a3fa"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/qca/hmtbtfw20.tlv;name=fw6;downloadfilename=hmtbtfw20.tlv"
SRC_URI[fw6.sha256sum] = "f1c00f4640a5c4e5dc36a2574d3d1d0afcfd1ab58a84f217dce4b1bb73cba981"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/qca/hmtnv20.bin;name=fw7;downloadfilename=hmtnv20.bin"
SRC_URI[fw7.sha256sum] = "c26b340bbc8b617304610c774627ac4879194705eea7a7c7b13e3593903befd9"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/qcom/gen80100_sqe.fw;name=fw8;downloadfilename=gen80100_sqe.fw"
SRC_URI[fw8.sha256sum] = "bfcc5193269855bab8961a83425d7ef1f1188e76cd6aee70a5a82f0c1aa7b258"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/qcom/gen80100_gmu.bin;name=fw9;downloadfilename=gen80100_gmu.bin"
SRC_URI[fw9.sha256sum] = "dae725872a751eccb73aa563dc2d4aeee3ddcc53805a900783787c329cab4d20"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/qcom/glymur/gen80100_zap.mbn;name=fw10;downloadfilename=gen80100_zap.mbn"
SRC_URI[fw10.sha256sum] = "c97ea72e3c6fb80831e478b5faae1101ffd5d40157f32e4cf0f426fa16c40282"
SRC_URI += "https://gitlab.com/kernel-firmware/linux-firmware/-/raw/${FIRMWARE_REV}/LICENSES/LICENSE.qcom;name=fw11;downloadfilename=LICENSE.qcom"
SRC_URI[fw11.sha256sum] = "be904cd28cb292b80cdb6cf412ab0d9159d431671e987ad433c1f62e0988a9bc"

do_install() {
    install -d ${D}${nonarch_base_libdir}/firmware/qcom/glymur

    install -d ${D}${nonarch_base_libdir}/firmware/ath12k/QCC2072/hw1.0 ${D}${nonarch_base_libdir}/firmware/qca
    install -m0644 ${S}/LICENSE.QualcommAtheros_ath10k ${D}${nonarch_base_libdir}/firmware/
    install -m0644 ${S}/board-2.bin ${D}${nonarch_base_libdir}/firmware/ath12k/QCC2072/hw1.0/board-2.bin
    install -m0644 ${S}/firmware-2.bin ${D}${nonarch_base_libdir}/firmware/ath12k/QCC2072/hw1.0/firmware-2.bin
    install -m0644 ${S}/Notice.txt ${D}${nonarch_base_libdir}/firmware/ath12k/QCC2072/hw1.0/Notice.txt
    install -m0644 ${S}/ornbtfw11.tlv ${D}${nonarch_base_libdir}/firmware/qca/ornbtfw11.tlv
    install -m0644 ${S}/ornnv11.bin ${D}${nonarch_base_libdir}/firmware/qca/ornnv11.bin
    install -m0644 ${S}/hmtbtfw20.tlv ${D}${nonarch_base_libdir}/firmware/qca/hmtbtfw20.tlv
    install -m0644 ${S}/hmtnv20.bin ${D}${nonarch_base_libdir}/firmware/qca/hmtnv20.bin
    install -m0644 ${S}/gen80100_sqe.fw ${D}${nonarch_base_libdir}/firmware/qcom/gen80100_sqe.fw
    install -m0644 ${S}/gen80100_gmu.bin ${D}${nonarch_base_libdir}/firmware/qcom/gen80100_gmu.bin
    install -m0644 ${S}/gen80100_zap.mbn ${D}${nonarch_base_libdir}/firmware/qcom/glymur/gen80100_zap.mbn
    install -m0644 ${S}/LICENSE.qcom ${D}${nonarch_base_libdir}/firmware/LICENSE.qcom
}
FILES:${PN} = "${nonarch_base_libdir}/firmware"
# Board calibration still must match the exact PCI subsystem and QMI board ID.
