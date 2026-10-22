#!/bin/bash
set -euo pipefail
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=${DEVOS_OE_WORK:-/var/tmp/devos-oe}
mode=${1:---build}
case "$mode" in --prepare|--parse|--kernel-check|--build) ;; *) echo 'Usage: build.sh [--prepare | --parse | --kernel-check | --build]' >&2; exit 2 ;; esac
mkdir -p "$work"
devlang_bin="$(command -v d || true)"
[ -n "$devlang_bin" ] || devlang_bin="$HOME/.local/bin/d"
[ -x "$devlang_bin" ] || { echo 'Missing build-host tool: DevLang runtime d. Install it to ~/.local/bin/d.' >&2; exit 2; }
# Hold this lock through preparation and BitBake, including metadata snapshots.
exec 9>"$work/devos-build.lock"
flock -n 9 || { echo 'DevOs build is already running. Let the existing build finish.' >&2; exit 75; }
"$devlang_bin" "$here/check-active-build.dev"
"$devlang_bin" "$here/prepare.dev" -- --work "$work"
[[ $mode != --prepare ]] || exit 0
if ! python3 -c 'import locale; locale.setlocale(locale.LC_ALL, "en_US.UTF-8")' 2>/dev/null; then
    command -v localedef >/dev/null || { echo 'Missing build-host tool: localedef (en_US.UTF-8 is required).' >&2; exit 2; }
    mkdir -p "$work/locale"
    localedef --no-archive -i en_US -f UTF-8 "$work/locale/en_US.UTF-8"
    export LOCPATH="$work/locale${LOCPATH:+:$LOCPATH}"
fi
export BB_ENV_PASSTHROUGH_ADDITIONS="${BB_ENV_PASSTHROUGH_ADDITIONS:-} LOCPATH"
export PATH="$work/bitbake/bin:$PATH"
export TEMPLATECONF="$work/openembedded-core/meta/conf/templates/default"
# oe-init-build-env expects a sibling bitbake checkout; provide that explicitly.
set +u
source "$work/openembedded-core/oe-init-build-env" "$work/build" "$work/bitbake" >/dev/null
set -u
if [[ $mode == --parse ]]; then
    bitbake -p
    bitbake -g devos-image > "$work/dependency-check.log" 2>&1 || {
        tail -50 "$work/dependency-check.log"; exit 1;
    }
    tail -5 "$work/dependency-check.log"
elif [[ $mode == --kernel-check ]]; then
    bitbake -c configure linux-devos
else bitbake devos-image; fi
