SUMMARY = "DevOs Linux Kernel from the DevOsLinuxKernel project"
LICENSE = "GPL-2.0-only"
DEVOS_KERNEL_VERSION ?= "0"
PV = "${DEVOS_KERNEL_VERSION}"
LIC_FILES_CHKSUM = "file://COPYING;md5=${DEVOS_KERNEL_LICENSE_MD5}"
FILESEXTRAPATHS:prepend := "${DEVOS_PAYLOAD_DIR}:${THISDIR}/files:"
SRC_URI = "file://devos-linux.tar.xz file://devos-kernel.config file://devos-desktop.cfg"
inherit kernel
# kernel.bbclass assigns S to STAGING_KERNEL_DIR. Override after inheritance
# so do_symlink_kernsrc moves the extracted archive into the shared source tree.
S = "${UNPACKDIR}/linux-${PV}"
COMPATIBLE_MACHINE = "qemuarm64"
KERNEL_IMAGETYPE = "Image"
KERNEL_DEVICETREE = ""
KERNEL_LOCALVERSION = ""
do_configure:prepend() {
    install -m0644 ${UNPACKDIR}/devos-kernel.config ${B}/.config
    sh ${S}/scripts/kconfig/merge_config.sh -m -O ${B} ${B}/.config ${UNPACKDIR}/devos-desktop.cfg
}
do_configure:append() {
    for setting in CONFIG_ARM64=y CONFIG_MODULES=y CONFIG_DRM_VIRTIO_GPU=y CONFIG_INPUT_EVDEV=y CONFIG_CGROUPS=y CONFIG_FHANDLE=y CONFIG_EXT4_FS=y; do
        grep -Fx "$setting" ${B}/.config >/dev/null || bbfatal "Missing desktop kernel requirement: $setting"
    done
}
