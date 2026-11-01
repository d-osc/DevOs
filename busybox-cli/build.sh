#!/bin/sh
# Builds the native busybox from DevLang: build.sh [OUTPUT] (default build/busybox-cli/busybox under the repository). Compiler chatter is hidden;
# on a failure its last lines are shown.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/.." && pwd)
output=${1:-"$root/build/busybox-cli/busybox"}
compiler=$(sh "$root/packages/react-devlang/tools/toolchain.sh")
mkdir -p "$(dirname -- "$output")"
log=$(mktemp)
driver=$(mktemp)
trap 'rm -f "$log" "$driver"' EXIT HUP INT TERM
if [ "${BUSYBOX_STATIC:-0}" = 1 ]; then
    printf '#!/bin/sh\nexec "${CC:-cc}" -static "$@"\n' > "$driver"
    chmod 755 "$driver"
    backend=$driver
else
    backend=${CC:-cc}
fi
if ! "$compiler" build "$here/main.dev" --release --cc "$backend" --cache-dir "$(dirname -- "$output")/.cache" -o "$output" > "$log" 2>&1; then
    grep -v 'warning\|^ *[0-9]* |\|\^~\|note:\|In file\|In function\|At top\|^$' "$log" | tail -30 >&2
    rm -f "$log"; echo "build failed" >&2; exit 1
fi
rm -f "$log"
[ -x "$output" ] || { echo "build failed" >&2; exit 1; }
