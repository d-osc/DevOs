SUMMARY = "Google Chrome bundled with DevOs"
HOMEPAGE = "https://www.google.com/chrome/"
require devos-vendor-app.inc
SRC_URI = "https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${PV}-1_${VENDOR_ARCH}.deb;subdir=vendor"
VENDOR_SHA256:aarch64 = "f98fcc80da576811e3212c87f53e01a367a1d05d7f7c33a013398a82a04bb00f"
VENDOR_SHA256:x86-64 = "8fbd2ae69cdf7ee98b7513c3396a7b5e06f974f8625fdd590df3091dd0c3e9de"
SRC_URI[sha256sum] = "${VENDOR_SHA256}"
do_install() {
    install -d ${D}/opt/google ${D}${bindir} ${D}${datadir}/icons/hicolor/256x256/apps
    cp -R --no-preserve=ownership ${S}/opt/google/chrome ${D}/opt/google/
    # DevOs uses GTK; optional Qt theme adapters require absent Qt runtimes.
    rm -f ${D}/opt/google/chrome/libqt5_shim.so ${D}/opt/google/chrome/libqt6_shim.so
    chmod 4755 ${D}/opt/google/chrome/chrome-sandbox
    ln -s /opt/google/chrome/google-chrome ${D}${bindir}/google-chrome-stable
    install -m0644 ${S}/opt/google/chrome/product_logo_256.png ${D}${datadir}/icons/hicolor/256x256/apps/google-chrome.png
}
