SUMMARY = "Microsoft Visual Studio Code bundled with DevOs"
HOMEPAGE = "https://code.visualstudio.com/"
require devos-vendor-app.inc
inherit mime python3native
DEPENDS += "libseccomp-native"
VSCODE_ARCH:aarch64 = "arm64"
VSCODE_ARCH:x86-64 = "x64"
SRC_URI = "https://update.code.visualstudio.com/${PV}/linux-deb-${VSCODE_ARCH}/stable;downloadfilename=code-${PV}-${VENDOR_ARCH}.deb;subdir=vendor"
VENDOR_SHA256:aarch64 = "036b445fe4c634f0917cb0d09f4ce43048da1b2797d3fd2169c645ea9a261af8"
VENDOR_SHA256:x86-64 = "33454f7d2d7bc79a5925b3e794d106fb454a10c6a635ddfeb908a63659a44ec5"
SRC_URI[sha256sum] = "${VENDOR_SHA256}"
# Rebuild the bundled x64-only sandbox helper for the target architecture.
unset do_compile[noexec]
do_compile() {
    sandbox=${S}/usr/share/code/resources/app/node_modules/@vscode/sandbox-runtime/vendor/seccomp-src
    ${BUILD_CC} ${BUILD_CPPFLAGS} ${BUILD_CFLAGS} ${BUILD_LDFLAGS} \
        "$sandbox/seccomp-unix-block.c" -lseccomp -o ${B}/seccomp-unix-block
    ${B}/seccomp-unix-block ${B}/unix-block.bpf ${TARGET_ARCH}
    ${PYTHON} -c 'import pathlib,sys; data=pathlib.Path(sys.argv[1]).read_bytes(); pathlib.Path(sys.argv[2]).write_text("static const unsigned char unix_block_bpf[] __attribute__((aligned(8))) = {" + ",".join(str(b) for b in data) + "};\n")' \
        ${B}/unix-block.bpf ${B}/unix-block-bpf.h
    ${CC} ${CPPFLAGS} ${CFLAGS} ${LDFLAGS} -I${B} \
        "$sandbox/apply-seccomp.c" -o ${B}/apply-seccomp
}

do_install() {
    install -d ${D}${datadir}/icons/hicolor/256x256/apps ${D}${datadir}/mime/packages ${D}${libdir}
    cp -R --no-preserve=ownership ${S}/usr/share/code ${D}${libdir}/devos-vscode
    # Keep the launcher path; install private ELF libraries under libdir.
    ln -s ${@os.path.relpath(d.getVar('libdir') + '/devos-vscode', d.getVar('datadir'))} ${D}${datadir}/code
    chmod 4755 ${D}${libdir}/devos-vscode/chrome-sandbox
    copilot=${D}${libdir}/devos-vscode/resources/app/node_modules.asar.unpacked/@github/copilot-sdk-linux-${VSCODE_ARCH}
    case "${VSCODE_ARCH}" in arm64) foreign=x64 ;; x64) foreign=arm64 ;; esac
    rm -rf "$copilot/ripgrep/bin/linux-$foreign" "$copilot/tgrep/bin/linux-$foreign"
    sandbox=${D}${libdir}/devos-vscode/resources/app/node_modules/@vscode/sandbox-runtime/vendor/seccomp
    rm -rf "$sandbox/$foreign"
    install -d "$sandbox/${VSCODE_ARCH}"
    install -m0755 ${B}/apply-seccomp "$sandbox/${VSCODE_ARCH}/apply-seccomp"
    install -m0644 ${S}/usr/share/pixmaps/vscode.png ${D}${datadir}/icons/hicolor/256x256/apps/vscode.png
    install -m0644 ${S}/usr/share/mime/packages/code-workspace.xml ${D}${datadir}/mime/packages/
    # /usr/bin/code belongs to devos-shell and selects native Wayland.
}
