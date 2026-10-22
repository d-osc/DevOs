#!/bin/sh
# WSL development host only; the DevOs image uses its OpenEmbedded recipe.
set -eu
if [ -x /usr/share/code/bin/code ]; then
    exit 0
fi
if [ "$(id -u)" != 0 ]; then
    printf '%s\n' 'Run with sudo sh tools/setup/bootstrap-vscode.sh' >&2
    exit 1
fi
case "$(dpkg --print-architecture)" in
    arm64) architecture=arm64 ;;
    amd64) architecture=x64 ;;
    *) printf '%s\n' 'VS Code requires ARM64 or amd64.' >&2; exit 1 ;;
esac
temporary=$(mktemp -d /tmp/dev-os-vscode-XXXXXXXX)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
package="$temporary/code.deb"
curl --fail --location --proto '=https' --proto-redir '=https' \
    --output "$package" "https://update.code.visualstudio.com/1.142.0/linux-deb-${architecture}/stable"
test "$(dpkg-deb -f "$package" Package)" = code
test "$(dpkg-deb -f "$package" Architecture)" = "$(dpkg --print-architecture)"
case "$architecture" in
    arm64) expected=036b445fe4c634f0917cb0d09f4ce43048da1b2797d3fd2169c645ea9a261af8 ;;
    x64) expected=33454f7d2d7bc79a5925b3e794d106fb454a10c6a635ddfeb908a63659a44ec5 ;;
esac
printf '%s  %s\n' "$expected" "$package" | sha256sum --check --status
chmod 755 "$temporary"
chmod 644 "$package"
DEBIAN_FRONTEND=noninteractive apt-get install -y "$package"
