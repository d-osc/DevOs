#!/bin/sh
# Runs the native Launcher in a headless labwc (a real layer-shell compositor) and prints what the client asked for. $1 = executable, $2 = DEV_OS_ROOT, $3 = labwc.
export XDG_RUNTIME_DIR=$(mktemp -d); chmod 700 "$XDG_RUNTIME_DIR"
T=$(mktemp -d); mkdir -p "$T/u/applications" "$T/prefs"
printf '[Desktop Entry]\nType=Application\nName=Alpha\nExec=a\n' > "$T/u/applications/alpha.desktop"
WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman "$3" > "$T/labwc.log" 2>&1 &
LP=$!
n=0; SOCK=""; while [ $n -lt 30 ] && [ -z "$SOCK" ]; do SOCK=$(ls "$XDG_RUNTIME_DIR" | grep -m1 '^wayland-[0-9]*$'); n=$((n+1)); sleep 0.3; done
WAYLAND_DISPLAY=$SOCK GDK_BACKEND=wayland WAYLAND_DEBUG=1 DEV_OS_ROOT=$2 DEVOS_LAUNCHER_TEST=1 DEVOS_LAUNCHER_DATA_DIRS="$T/u" DEVOS_PREFERENCES_DIR="$T/prefs" NO_AT_BRIDGE=1 timeout 8 "$1" > "$T/app.log" 2>&1
grep -E "get_layer_surface|set_anchor|set_keyboard_interactivity|set_exclusive_zone|layer_surface_v1#[0-9]+\.configure" "$T/app.log" | sed 's/^\[[^]]*\] *{[^}]*} *//' | cut -c1-120 | head -8
kill $LP 2>/dev/null; rm -rf "$T" "$XDG_RUNTIME_DIR"
