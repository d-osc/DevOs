#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
sh "$root/tools/build/native-background.sh"
math=$(${CC:-cc} -print-file-name=libm.so.6)
layer=$(${CC:-cc} -print-file-name=libgtk-layer-shell.so.0)
output="$root/build/react-devlang/background"
sh "$root/packages/react-devlang/tools/build.sh" "$root/src/system/org.devos.background/native-settings-main.devx" "$output/background-settings" "$output/host.o" "$math" "$layer"
temporary=$(mktemp "$root/dist/native/.background-settings.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
install -m0755 "$output/background-settings" "$temporary"
mv -f -- "$temporary" "$root/dist/native/background-settings-preview"
temporary=$(mktemp "$root/dist/native/.background-settings.XXXXXX")
install -m0755 "$output/background-settings" "$temporary"
mv -f -- "$temporary" "$root/dist/native/background-settings"
