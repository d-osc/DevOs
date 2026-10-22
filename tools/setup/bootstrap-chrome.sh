#!/bin/sh
# Optional Google Chrome installation from Google's native Debian package.
set -eu
if [ "$(id -u)" != 0 ]; then
    printf '%s\n' 'Run with sudo sh tools/setup/bootstrap-chrome.sh' >&2
    exit 1
fi
case "$(dpkg --print-architecture)" in
    arm64) architecture=arm64 ;;
    amd64) architecture=amd64 ;;
    *) printf '%s\n' 'Google Chrome requires ARM64 or amd64.' >&2; exit 1 ;;
esac
apt-get install -y fonts-noto-core
if command -v google-chrome-stable >/dev/null 2>&1; then
    google-chrome-stable --version
    exit 0
fi
temporary=$(mktemp -d /tmp/dev-os-chrome-XXXXXXXX)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
package="$temporary/google-chrome-stable.deb"
curl --fail --location --proto '=https' --proto-redir '=https' \
    --output "$package" "https://dl.google.com/linux/direct/google-chrome-stable_current_${architecture}.deb"
test "$(dpkg-deb -f "$package" Package)" = google-chrome-stable
test "$(dpkg-deb -f "$package" Architecture)" = "$architecture"
chmod 755 "$temporary"
chmod 644 "$package"
apt-get install -y "$package"
google-chrome-stable --version
