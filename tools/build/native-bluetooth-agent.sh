#!/bin/sh
# Builds the Bluetooth pairing agent used by the native Settings page into dist/native.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
mkdir -p "$root/dist/native"
temporary=$(mktemp "$root/dist/native/.bluetooth-agent.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
trap 'exit 1' HUP INT TERM
${CC:-cc} -std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -Werror "$root/native/devos-bluetooth-agent.c" \
    $(pkg-config --cflags --libs gio-2.0 gio-unix-2.0) -o "$temporary"
chmod 0755 "$temporary"
mv -f -- "$temporary" "$root/dist/native/devos-bluetooth-agent"
