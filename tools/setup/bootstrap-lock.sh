#!/bin/sh
# Keep the Ubuntu 24.04 binary and PAM configuration at the tested package revision.
set -eu
package_version=1.7.2-1build2
if command -v swaylock >/dev/null 2>&1 && [ -f /etc/pam.d/swaylock ] &&
    [ "$(dpkg-query -W -f='${Version}' swaylock 2>/dev/null)" = "$package_version" ] &&
    apt-mark showhold swaylock | grep -qx swaylock; then
    printf 'Lock screen dependency pinned: swaylock %s with PAM.\n' "$package_version"
    exit 0
fi
if ! command -v apt-get >/dev/null 2>&1; then
    printf '%s\n' 'This installer requires Ubuntu 24.04 swaylock 1.7.2-1build2, including its PAM configuration.' >&2
    exit 1
fi
if [ "$(id -u)" = 0 ]; then
    apt-get install -y --allow-downgrades --allow-change-held-packages "swaylock=$package_version"
    apt-mark hold swaylock
else
    sudo apt-get install -y --allow-downgrades --allow-change-held-packages "swaylock=$package_version"
    sudo apt-mark hold swaylock
fi
command -v swaylock >/dev/null 2>&1
test -f /etc/pam.d/swaylock
test "$(swaylock --version)" = 'swaylock version 1.7.2'
