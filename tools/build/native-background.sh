#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output="$root/build/react-devlang/background"
mkdir -p "$output" "$root/dist/native"
image_temporary=$(mktemp "$root/dist/native/.background-image.XXXXXX")
trap 'rm -f -- "$image_temporary"' EXIT
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -shared "$root/src/system/org.devos.background/image-validate.c" $(pkg-config --cflags --libs gdk-pixbuf-2.0) -o "$image_temporary"
chmod 0755 "$image_temporary"
mv -f -- "$image_temporary" "$root/dist/native/libbackground-image.so"
trap - EXIT
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -c "$root/src/system/org.devos.background/native-host.c" $(pkg-config --cflags gtk+-3.0) -o "$output/host.o"
math=$(${CC:-cc} -print-file-name=libm.so.6)
layer=$(${CC:-cc} -print-file-name=libgtk-layer-shell.so.0)
if [ "$layer" = libgtk-layer-shell.so.0 ]; then echo 'GTK layer-shell runtime is required' >&2; exit 1; fi
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/system/org.devos.background/native-main.devx" "$output/background" "$output/host.o" "$math" "$layer"
temporary=$(mktemp "$root/dist/native/.background-preview.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
trap 'exit 1' HUP INT TERM
install -m0755 "$output/background" "$temporary"
mv -f -- "$temporary" "$root/dist/native/background-preview"
temporary=$(mktemp "$root/dist/native/.background.XXXXXX")
install -m0755 "$output/background" "$temporary"
mv -f -- "$temporary" "$root/dist/native/background"
