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
"$driver" "$root/tools/build/native-theme.dev" -- "$root"
sh "$root/tools/build/native-system.sh"
sh "$root/tools/build/native-supervisor.sh"
sh "$root/tools/build/native-splash.sh"
sh "$root/tools/build/native-bluetooth-agent.sh"
