#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output="$root/build/react-devlang/panel"
mkdir -p "$output" "$root/dist/native"
sh "$root/tools/build/native-supervisor.sh"
clock_library=$(mktemp "$root/dist/native/.panel-clock.XXXXXX")
trap 'rm -f -- "$clock_library"' EXIT
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -shared "$root/src/system/org.devos.panel/clock-host.c" $(pkg-config --cflags --libs glib-2.0) -o "$clock_library"
chmod 0755 "$clock_library"
mv -f -- "$clock_library" "$root/dist/native/libpanel-clock.so"
trap - EXIT
taskbar_library=$(mktemp "$root/dist/native/.panel-taskbar.XXXXXX")
trap 'rm -f -- "$taskbar_library"' EXIT
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -shared "$root/src/system/org.devos.panel/catalog-host.c" "$root/native/supervisor-host.c" $(pkg-config --cflags --libs gio-2.0 gio-unix-2.0) -ldl -o "$taskbar_library"
chmod 0755 "$taskbar_library"
mv -f -- "$taskbar_library" "$root/dist/native/libpanel-taskbar.so"
trap - EXIT
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -c "$root/src/system/org.devos.panel/layout-host.c" $(pkg-config --cflags gtk+-3.0) -o "$output/host.o"
layer=$(${CC:-cc} -print-file-name=libgtk-layer-shell.so.0)
if [ "$layer" = libgtk-layer-shell.so.0 ]; then echo 'GTK layer-shell runtime is required' >&2; exit 1; fi
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/system/org.devos.panel/native.devx" "$output/panel-layout-preview" "$output/host.o" "$layer"
temporary=$(mktemp "$root/dist/native/.panel-layout-preview.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
install -m0755 "$output/panel-layout-preview" "$temporary"
mv -f -- "$temporary" "$root/dist/native/panel-layout-preview"
temporary=$(mktemp "$root/dist/native/.panel.XXXXXX")
install -m0755 "$output/panel-layout-preview" "$temporary"
mv -f -- "$temporary" "$root/dist/native/panel"
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/system/org.devos.panel/native-settings-main.devx" "$output/panel-settings" "$output/host.o" "$layer"
temporary=$(mktemp "$root/dist/native/.panel-settings.XXXXXX")
install -m0755 "$output/panel-settings" "$temporary"
mv -f -- "$temporary" "$root/dist/native/panel-settings"
