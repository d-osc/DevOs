#!/bin/sh
# Type-check DevLang JSX without a GTK SDK, a C compile, or a running display.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
source=${1:-"$root/packages/react-devlang/examples/counter.devx"}
if [ "$#" -gt 0 ]; then shift; fi
mode=
for option in "$@"; do if [ "$option" = --syntax-only ]; then mode=--runtime; fi; done
compiler=$(sh "$root/packages/react-devlang/tools/toolchain.sh" $mode)
runner=${DEVLANG_RUN:-$compiler}
exec "$runner" "$root/packages/react-devlang/tools/devx.dev" -- check "$source" \
    --out-dir "$root/build/react-devlang/check" --compiler "$compiler" "$@"
