#!/bin/sh
# Native-only build: GTK development headers, a C11 compiler, and DevLang d/devc.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
source=${1:-"$root/packages/react-devlang/examples/counter.devx"}
output=${2:-"$root/build/react-devlang/counter"}
exec sh "$root/packages/react-devlang/tools/build.sh" "$source" "$output"
