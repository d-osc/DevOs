#!/bin/sh
# Read-only disk inventory dependencies for WSL development.
set -eu
if [ "$(id -u)" != 0 ]; then printf '%s\n' 'Run as root.' >&2; exit 1; fi
if ! command -v lsblk >/dev/null 2>&1; then
    apt-get update
    apt-get install -y util-linux
fi
