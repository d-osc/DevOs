# Vendor binaries are repackaged into DevOs; no Debian rootfs, maintainer
# scripts, apt sources or host libraries are copied into the target.
LICENSE = "CLOSED"
COMPATIBLE_HOST = "(aarch64|x86_64).*-linux"
PACKAGE_ARCH = "${TUNE_PKGARCH}"
VENDOR_ARCH:aarch64 = "arm64"
VENDOR_ARCH:x86-64 = "amd64"
S = "${UNPACKDIR}/vendor"
inherit bin_package gtk-icon-cache
DEPENDS = "alsa-lib at-spi2-core cairo cups curl dbus expat glib-2.0 gtk+3 \
    libx11 libxcb libxcomposite libxdamage libxext libxfixes libxkbcommon \
    libxkbfile libxrandr mesa nspr nss pango systemd vulkan-loader hicolor-icon-theme"
RDEPENDS:${PN} = "bash ca-certificates xdg-utils ttf-liberation-sans ttf-liberation-serif ttf-liberation-mono"
# Keep upstream binaries intact. Shared-library dependency QA remains enabled.
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INSANE_SKIP:${PN} += "ldflags already-stripped"
PRIVATE_LIBS = "libEGL.so libGLESv2.so libvk_swiftshader.so libvulkan.so.1 libffmpeg.so"
FILES:${PN} = "/opt /usr"
