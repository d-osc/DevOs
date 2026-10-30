#!/bin/sh
# Build a DevLang UI into a native GTK executable. No GJS or Node is required.
set -eu
library=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source=${1:-"$library/examples/counter.devx"}
output=${2:-"$library/build/counter"}
extra_object=${3:-}
extra_library=${4:-}
extra_library2=${5:-}
directory=$(dirname -- "$output")
mkdir -p -- "$directory"
manifest=
compiler=$(sh "$library/tools/toolchain.sh")
runner=${DEVLANG_RUN:-$compiler}
case "$source" in
    *.devx)
        source=$("$runner" "$library/tools/devx.dev" -- emit "$source" --out-dir "$directory/.devx")
        manifest="$source.manifest.json"
        ;;
esac
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -c "$library/native/gtk.c" \
    $(pkg-config --cflags gtk+-3.0) -o "$directory/react-devlang-gtk.o"
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -c "$library/native/channel.c" \
    $(pkg-config --cflags gtk+-3.0) -o "$directory/react-devlang-channel.o"
${CC:-cc} -std=c11 -Wall -Wextra -Werror -fPIC -c "$library/native/theme.c" \
    $(pkg-config --cflags gtk+-3.0) -o "$directory/react-devlang-theme.o"
set -- build "$source" --release --cc "${CC:-cc}" --cache-dir "$directory/.dev-cache" --module-dir "react_devlang=$library/src" --link "$directory/react-devlang-gtk.o" --link "$directory/react-devlang-channel.o" --link "$directory/react-devlang-theme.o" -o "$output"
if [ -n "$extra_object" ]; then set -- "$@" --link "$extra_object"; fi
if [ -n "$extra_library" ]; then set -- "$@" --link "$extra_library"; fi
if [ -n "$extra_library2" ]; then set -- "$@" --link "$extra_library2"; fi
for flag in $(pkg-config --libs-only-l gtk+-3.0); do
    name="lib${flag#-l}.so"
    path=$(${CC:-cc} -print-file-name="$name")
    if [ "$path" = "$name" ]; then echo "Cannot resolve GTK link library: $name" >&2; exit 1; fi
    set -- "$@" --link "$path"
done
if [ -n "$manifest" ]; then
    "$runner" "$library/tools/devx.dev" -- compile "$manifest" -- "$compiler" "$@"
else
    "$compiler" "$@"
fi
