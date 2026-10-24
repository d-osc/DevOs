FILESEXTRAPATHS:prepend := "${DEVOS_PAYLOAD_DIR}:"
SRC_URI:append = " file://patch-task-view-gesture.dev file://devos-task-view.h file://devos-desktop-animation.h file://devos-window-animation.c file://patch-task-view-workspaces.dev file://devos-workspaces.c file://devos-workspaces-v1.xml file://patch-touchpad.dev file://devos-touchpad.h"
do_configure:prepend() {
    # Both patch installers use the host DevLang pinned by prepare.dev.
    "${DEVOS_DEVLANG_BIN}" ${UNPACKDIR}/patch-task-view-gesture.dev -- ${S}
    "${DEVOS_DEVLANG_BIN}" ${UNPACKDIR}/patch-task-view-workspaces.dev -- ${S}
    "${DEVOS_DEVLANG_BIN}" ${UNPACKDIR}/patch-touchpad.dev -- ${S}
}
