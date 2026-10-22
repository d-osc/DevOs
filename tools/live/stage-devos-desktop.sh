#!/bin/bash
set -euo pipefail
work=${DEVOS_LIVE_WORK:-/var/tmp/devos-live-build}
root=$work/rootfs
source=${DEVOS_SOURCE_ROOT:-/mnt/c/Users/ondev/Projects/DevOs}
target=$root/opt/devos
mkdir -p "$target/native" "$target/build/wsl/bin" "$root/usr/local/bin" "$root/usr/share/wayland-sessions"
for directory in bin lib dist data config extensions; do
    rsync -a --exclude '__pycache__' --exclude '*.pyc' "$source/$directory/" "$target/$directory/"
done
install -m755 "$source/build/native/dev-os-window-tracker" "$target/native/dev-os-window-tracker"
install -m755 "$source/build/wsl/bin/labwc" "$target/build/wsl/bin/labwc"
chmod 755 "$target/bin/"*
for executable in dev-os-shell dev-os-start dev-os-session; do
    ln -sfn "/opt/devos/bin/$executable" "$root/usr/local/bin/$executable"
done
ln -sfn /opt/devos/build/wsl/bin/labwc "$root/usr/local/bin/labwc"
cat > "$root/usr/local/bin/devos-live-session" <<'EOF'
#!/bin/sh
set -eu
export PATH=/opt/devos/bin:/opt/devos/build/wsl/bin:/usr/local/bin:/usr/bin:/bin
export XDG_DATA_DIRS=/opt/devos/data:/usr/local/share:/usr/share
export XDG_CURRENT_DESKTOP=DevOS:labwc XDG_SESSION_DESKTOP=devos XDG_SESSION_TYPE=wayland
case " $(cat /proc/cmdline) " in
    *' devos.renderer=auto '*) unset WLR_RENDERER ;;
    *) export WLR_RENDERER=pixman ;;
esac
mkdir -p "$HOME/.local/state/devos"
exec >>"$HOME/.local/state/devos/session.log" 2>&1
exec /opt/devos/bin/dev-os-session
EOF
chmod 755 "$root/usr/local/bin/devos-live-session"
cat > "$root/usr/share/wayland-sessions/devos.desktop" <<'EOF'
[Desktop Entry]
Name=DevOs Live
Comment=DevOs native Wayland desktop
Exec=/usr/local/bin/devos-live-session
TryExec=/usr/local/bin/devos-live-session
Type=Application
DesktopNames=DevOS;labwc;
EOF
sed -i '/^DefaultSession=devos.desktop$/d' "$root/etc/gdm3/custom.conf"
sed -i '/^\[daemon\]/a DefaultSession=devos.desktop' "$root/etc/gdm3/custom.conf"
mkdir -p "$root/etc/skel/.config/dev-os" "$root/var/lib/AccountsService/users"
cat > "$root/etc/skel/.config/dev-os/config.json" <<'EOF'
{"autostart":[["/usr/lib/policykit-1-gnome/polkit-gnome-authentication-agent-1"],["nm-applet"]]}
EOF
printf '[Desktop]\nSession=devos\n' > "$root/etc/skel/.dmrc"
cat > "$root/var/lib/AccountsService/users/devos" <<'EOF'
[User]
Session=devos
XSession=devos
SystemAccount=false
EOF
cat > "$root/etc/casper.conf" <<'EOF'
export USERNAME=devos
export USERFULLNAME="DevOs Live"
export HOST=devos-live
export BUILD_SYSTEM=Ubuntu
export FLAVOUR=DevOs
EOF
# Default image only boots the live session. No installer is exposed by DevOs.
mkdir -p "$root/etc/systemd/logind.conf.d"
printf '[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchExternalPower=ignore\n' > "$root/etc/systemd/logind.conf.d/90-devos-live.conf"
# Do not allow automounting internal volumes from this test session.
mkdir -p "$root/etc/polkit-1/rules.d"
cat > "$root/etc/polkit-1/rules.d/49-devos-live-internal-disks.rules" <<'EOF'
polkit.addRule(function(action, subject) {
    if (subject.user == "devos" && (action.id == "org.freedesktop.udisks2.filesystem-mount-system" || action.id == "org.freedesktop.udisks2.modify-device-system")) {
        return polkit.Result.NO;
    }
});
EOF
install -m755 "$(dirname "$0")/collect-native-readiness.sh" "$root/usr/local/bin/devos-hardware-report"
install -m755 "$(dirname "$0")/90devos-session" "$root/usr/share/initramfs-tools/scripts/casper-bottom/90devos-session"
chroot "$root" /bin/sh -c 'export PATH=/usr/local/bin:/usr/bin:/bin; /opt/devos/bin/dev-os-shell doctor; /opt/devos/bin/dev-os-shell --version; labwc --version'
printf '%s\n' 'DevOs desktop staged.'
