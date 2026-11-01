#!/usr/bin/env bash
# Build the repo's native DevLang multi-call binary and its separate POSIX shell.
set -euo pipefail
source "$(dirname "$0")/common.sh"
BUSYBOX_ROOT="$WORK/repo-busybox-root-$DEVOS_ARCH"
log "=== DevOs: building repository busybox-cli ($DEVOS_ARCH) ==="
bash "$REPO/../tools/build/userland.sh" busybox "$BUSYBOX_ROOT" "$DEVOS_ARCH"
ok "busybox-cli staged: $BUSYBOX_ROOT/bin/busybox"
