#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output="$root/build/react-devlang/login"
mkdir -p "$output" "$root/dist/native"
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -c "$root/src/system/login/host.c" $(pkg-config --cflags gtk+-3.0) -o "$output/host.o"
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/system/login/native-main.devx" "$output/login" "$output/host.o"
temporary=$(mktemp "$root/dist/native/.login-preview.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
trap 'exit 1' HUP INT TERM
install -m0755 "$output/login" "$temporary"
mv -f -- "$temporary" "$root/dist/native/login-preview"
