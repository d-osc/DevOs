UCM_X2_REV = "e8d50c6e0b39d2fc495599736fe66dbe03a87a62"
SRC_URI += "https://raw.githubusercontent.com/alsa-project/alsa-ucm-conf/${UCM_X2_REV}/ucm2/Qualcomm/glymur/ASUS-Zenbook-A14-UX3407NA.conf;name=x2ucm0;downloadfilename=x2-0-ASUS-Zenbook-A14-UX3407NA.conf"
SRC_URI[x2ucm0.sha256sum] = "feef01a8007720ff338e3b68990e4afd2be3604dd336c522b6717a0071c3784c"
SRC_URI += "https://raw.githubusercontent.com/alsa-project/alsa-ucm-conf/${UCM_X2_REV}/ucm2/Qualcomm/glymur/glymur.conf;name=x2ucm1;downloadfilename=x2-1-glymur.conf"
SRC_URI[x2ucm1.sha256sum] = "765e20182070c0649cacedbcc5a42d439f62b5df9d5063e8b9d4fb76ea63e5b4"
SRC_URI += "https://raw.githubusercontent.com/alsa-project/alsa-ucm-conf/${UCM_X2_REV}/ucm2/Qualcomm/glymur/ZenbookA14-HiFi.conf;name=x2ucm2;downloadfilename=x2-2-ZenbookA14-HiFi.conf"
SRC_URI[x2ucm2.sha256sum] = "c3c73caafc62d37fdd10ac5e51f1a662d404298732a0a3936d120b59ebe2c958"
SRC_URI += "https://raw.githubusercontent.com/alsa-project/alsa-ucm-conf/${UCM_X2_REV}/ucm2/codecs/qcom-lpass/wsa-macro/two-speakers/init.conf;name=x2ucm3;downloadfilename=x2-3-init.conf"
SRC_URI[x2ucm3.sha256sum] = "d610ac3792864f6f091cec2acd27bad08e9201e966aa3891941089da295da9ed"
do_install:append() {
    install -d ${D}${datadir}/alsa/ucm2/Qualcomm/glymur
    install -m0644 ${UNPACKDIR}/x2-0-ASUS-Zenbook-A14-UX3407NA.conf ${D}${datadir}/alsa/ucm2/Qualcomm/glymur/ASUS-Zenbook-A14-UX3407NA.conf
    install -d ${D}${datadir}/alsa/ucm2/Qualcomm/glymur
    install -m0644 ${UNPACKDIR}/x2-1-glymur.conf ${D}${datadir}/alsa/ucm2/Qualcomm/glymur/glymur.conf
    install -d ${D}${datadir}/alsa/ucm2/Qualcomm/glymur
    install -m0644 ${UNPACKDIR}/x2-2-ZenbookA14-HiFi.conf ${D}${datadir}/alsa/ucm2/Qualcomm/glymur/ZenbookA14-HiFi.conf
    install -d ${D}${datadir}/alsa/ucm2/codecs/qcom-lpass/wsa-macro/two-speakers
    install -m0644 ${UNPACKDIR}/x2-3-init.conf ${D}${datadir}/alsa/ucm2/codecs/qcom-lpass/wsa-macro/two-speakers/init.conf
    install -d ${D}${datadir}/alsa/ucm2/conf.d/glymur
    ln -sf ../../Qualcomm/glymur/glymur.conf ${D}${datadir}/alsa/ucm2/conf.d/glymur/glymur.conf
}
