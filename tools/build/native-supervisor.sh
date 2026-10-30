#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
mkdir -p "$root/dist/native"
temporary=$(mktemp "$root/dist/native/.libsupervisor.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
trap 'exit 1' HUP INT TERM
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -shared "$root/native/supervisor-host.c" \
    $(pkg-config --cflags --libs gio-2.0 gio-unix-2.0) -ldl -o "$temporary"
chmod 0755 "$temporary"
mv -f -- "$temporary" "$root/dist/native/libsupervisor.so"
