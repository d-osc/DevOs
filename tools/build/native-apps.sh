#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
driver=$(sh "$root/packages/react-devlang/tools/toolchain.sh" --runtime)
"$driver" "$root/tools/theme/generate-palette.dev"
sh "$root/packages/react-devlang/tools/build.sh" \
    "$root/src/apps/org.devos.taskmanager/native-main.devx" "$root/build/react-devlang/apps/taskmanager"
mkdir -p "$root/dist/native"
install -m0755 "$root/build/react-devlang/apps/taskmanager" "$root/dist/native/taskmanager"
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/apps/org.devos.diskmanager/native-main.devx" "$root/build/react-devlang/apps/diskmanager"
install -m0755 "$root/build/react-devlang/apps/diskmanager" "$root/dist/native/diskmanager"
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/apps/org.devos.installer/native-main.devx" "$root/build/react-devlang/apps/installer"
install -m0755 "$root/build/react-devlang/apps/installer" "$root/dist/native/installer"
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/apps/org.devos.settings/native-main.devx" "$root/build/react-devlang/apps/settings"
install -m0755 "$root/build/react-devlang/apps/settings" "$root/dist/native/settings"
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/apps/org.devos.files/native-main.devx" "$root/build/react-devlang/apps/files"
install -m0755 "$root/build/react-devlang/apps/files" "$root/dist/native/files"
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/apps/org.devos.appstore/native-main.devx" "$root/build/react-devlang/apps/appstore"
install -m0755 "$root/build/react-devlang/apps/appstore" "$root/dist/native/appstore"
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/system/org.devos.launcher/native-main.devx" "$root/build/react-devlang/apps/launcher"
install -m0755 "$root/build/react-devlang/apps/launcher" "$root/dist/native/launcher"
vte=$(${CC:-cc} -print-file-name=libvte-2.91.so.0)
if [ "$vte" != libvte-2.91.so.0 ]; then
    sh "$root/packages/react-devlang/tools/build.sh" "$root/src/apps/org.devos.terminal/native-main.devx" "$root/build/react-devlang/apps/terminal" "$vte"
    install -m0755 "$root/build/react-devlang/apps/terminal" "$root/dist/native/terminal"
fi
webkit=$(${CC:-cc} -print-file-name=libwebkit2gtk-4.1.so.0)
if [ "$webkit" != libwebkit2gtk-4.1.so.0 ]; then
    sh "$root/packages/react-devlang/tools/build.sh" "$root/src/apps/org.devos.browser/native-main.devx" "$root/build/react-devlang/apps/browser" "$webkit"
    install -m0755 "$root/build/react-devlang/apps/browser" "$root/dist/native/browser"
    sh "$root/packages/react-devlang/tools/build.sh" "$root/src/apps/org.devos.editor/native-main.devx" "$root/build/react-devlang/apps/editor" "$webkit"
    install -m0755 "$root/build/react-devlang/apps/editor" "$root/dist/native/editor"
fi
gst=$(${CC:-cc} -print-file-name=libgstreamer-1.0.so.0)
if [ "$gst" != libgstreamer-1.0.so.0 ]; then
    sh "$root/packages/react-devlang/tools/build.sh" "$root/src/apps/org.devos.camera/native-main.devx" "$root/build/react-devlang/apps/camera" "$gst"
    install -m0755 "$root/build/react-devlang/apps/camera" "$root/dist/native/camera"
    sh "$root/packages/react-devlang/tools/build.sh" "$root/src/apps/org.devos.microphone/native-main.devx" "$root/build/react-devlang/apps/microphone" "$gst"
    install -m0755 "$root/build/react-devlang/apps/microphone" "$root/dist/native/microphone"
fi
"$driver" "$root/tools/build/native-theme.dev" -- "$root"
sh "$root/tools/build/native-system.sh"
sh "$root/tools/build/native-supervisor.sh"
sh "$root/tools/build/native-splash.sh"
sh "$root/tools/build/native-bluetooth-agent.sh"
