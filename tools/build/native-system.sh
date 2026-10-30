#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output="$root/build/react-devlang/system"
mkdir -p "$output" "$root/dist/native"
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -c "$root/src/system/native-host.c" \
    $(pkg-config --cflags gtk+-3.0 gio-unix-2.0) -o "$output/host.o"
layer=$(${CC:-cc} -print-file-name=libgtk-layer-shell.so.0)
if [ "$layer" = libgtk-layer-shell.so.0 ]; then echo 'GTK layer-shell runtime is required' >&2; exit 1; fi
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/system/org.devos.displaycare/native.dev" "$output/displaycare" "$output/host.o" "$layer"
install -m0755 "$output/displaycare" "$root/dist/native/system-displaycare"
sh "$root/tools/build/native-background-runtime.sh"
sh "$root/tools/build/native-panel-runtime.sh"
