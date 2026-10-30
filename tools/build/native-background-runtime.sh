#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
sh "$root/tools/build/native-background-settings.sh"
output="$root/build/react-devlang/background"
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -c "$root/src/system/org.devos.background/runtime-host.c" $(pkg-config --cflags gtk+-3.0) -o "$output/runtime-host.o"
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -c "$root/native/supervisor-host.c" $(pkg-config --cflags gio-2.0 gio-unix-2.0) -o "$output/runtime-process.o"
${CC:-cc} -r "$output/runtime-host.o" "$output/runtime-process.o" -o "$output/runtime.o"
layer=$(${CC:-cc} -print-file-name=libgtk-layer-shell.so.0)
dl=$(${CC:-cc} -print-file-name=libdl.so.2)
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/system/org.devos.background/runtime.dev" "$output/runtime" "$output/runtime.o" "$layer" "$dl"
temporary=$(mktemp "$root/dist/native/.system-background.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
install -m0755 "$output/runtime" "$temporary"
mv -f -- "$temporary" "$root/dist/native/system-background"
