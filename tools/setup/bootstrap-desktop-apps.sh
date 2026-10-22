#!/bin/sh
# Prepare the WSL host. These apt-based helpers never run inside the DevOs image.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$here/bootstrap-accounts.sh"
sh "$here/bootstrap-disks.sh"
if [ -x /usr/bin/google-chrome-stable ] && [ -x /usr/share/code/bin/code ]; then exit 0; fi
sh "$here/bootstrap-chrome.sh"
sh "$here/bootstrap-vscode.sh"
