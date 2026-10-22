#!/bin/sh
# Install trusted helpers for WSL development. Never replaces the host PAM stack.
set -eu
if [ "$(id -u)" != 0 ]; then printf '%s\n' 'Run this installer as root.' >&2; exit 1; fi
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
# Privileged launchers deliberately use /usr/bin/d rather than caller PATH.
# The installer must provision a root-owned runtime before installing services.
if [ ! -x /usr/bin/d ]; then
    printf '%s\n' 'Install DevLang v0.5.5+ as root at /usr/bin/d before installing account services.' >&2
    exit 1
fi
for runtime in /usr/bin/d /usr/bin/devrun; do
    details=$(stat -Lc '%u:%a' "$runtime")
    case "$details" in
        0:*[2367]?|0:*[2367]) printf '%s\n' 'DevLang runtime must not be group/other writable.' >&2; exit 1 ;;
        0:*) ;;
        *) printf '%s\n' 'DevLang runtime must be root-owned.' >&2; exit 1 ;;
    esac
done
version=$(/usr/bin/d --version)
if ! printf '%s\n' "$version" | awk '{ split($2,v,"."); exit !(v[1]>0 || v[2]>5 || (v[2]==5 && v[3]>=5)) }'; then
    printf '%s\n' 'DevLang v0.5.5 or newer is required.' >&2
    exit 1
fi
if ! command -v pkexec >/dev/null 2>&1 || [ ! -x /usr/lib/policykit-1-gnome/polkit-gnome-authentication-agent-1 ]; then
    apt-get install -y pkexec policykit-1-gnome
fi
install -d -m0755 /usr/share/dev-os/native /usr/share/dev-os/lib /usr/libexec /usr/share/polkit-1/actions /var/lib/devos
install -o root -g root -m0644 "$root/native/"*.dev /usr/share/dev-os/native/
install -o root -g root -m0644 "$root/lib/"*.dev /usr/share/dev-os/lib/
install -o root -g root -m0755 "$root/native/devos-account-admin" /usr/libexec/devos-account-admin
install -o root -g root -m0755 "$root/native/devos-account-admin" /usr/libexec/devos-account-setup
install -o root -g root -m0755 "$root/native/devos-pam-auth" /usr/libexec/devos-pam-auth
install -o root -g root -m0755 "$root/native/devos-account-askpass" /usr/libexec/devos-account-askpass
install -o root -g root -m0644 "$root/data/polkit-1/actions/org.devos.accounts.policy" /usr/share/polkit-1/actions/
printf '%s\n' 'DevOs account management installed; host login and PAM configuration preserved.'
