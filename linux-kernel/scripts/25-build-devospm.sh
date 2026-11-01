#!/usr/bin/env bash
# Stage pm-cli sources with a static, target-built DevLang runtime.
set -euo pipefail
source "$(dirname "$0")/common.sh"
PM_ROOT="$WORK/pm-cli-root-$DEVOS_ARCH"
log "=== DevOs: staging repository pm-cli ($DEVOS_ARCH) ==="
bash "$REPO/../tools/build/userland.sh" pm "$PM_ROOT" "$DEVOS_ARCH"
cp "$PM_ROOT/usr/share/devos-pm/version" "$WORK/devospm-version.txt"
ok "pm-cli staged: $PM_ROOT/usr/bin/dev"
