#!/bin/sh
# Find a complete driver installation; non-login WSL PATH can expose a stale d.
set -eu
if [ -n "${DEVLANG_D:-}" ]; then
    command -v "$DEVLANG_D"
    exit
fi
for candidate in "$(command -v d || true)" "${HOME:-}/.local/bin/d"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    candidate=$(readlink -f "$candidate")
    directory=$(dirname "$candidate")
    [ -x "$directory/devrun" ] || continue
    if [ "${1:-}" != --runtime ]; then [ -x "$directory/devc" ] || continue; fi
    printf '%s\n' "$candidate"
    exit 0
done
printf '%s\n' 'A complete DevLang installation is required (d, devrun and devc for native builds).' >&2
exit 1
