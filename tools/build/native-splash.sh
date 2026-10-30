#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output="$root/build/react-devlang/splash"
mkdir -p "$output" "$root/dist/native"
driver=$(sh "$root/packages/react-devlang/tools/toolchain.sh" --runtime)
"$driver" "$root/tools/build/splash-font.dev"
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -c "$root/src/system/splash-host.c" \
    $(pkg-config --cflags gtk+-3.0 gio-unix-2.0) -o "$output/host.o"
math=$(${CC:-cc} -print-file-name=libm.so.6)
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/system/splash.dev" "$output/boot-splash" "$output/host.o" "$math"
temporary=$(mktemp "$root/dist/native/.boot-splash.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
trap 'exit 1' HUP INT TERM
install -m0755 "$output/boot-splash" "$temporary"
mv -f -- "$temporary" "$root/dist/native/boot-splash"
