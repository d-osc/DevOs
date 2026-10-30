#!/bin/sh
# Run inside `dbus-run-session -- xvfb-run`: starts the native Launcher window and sends it the commands the shell sends, over D-Bus.
# $1 = the executable, $2 = DEV_OS_ROOT. Prints one line per check.
T=$(mktemp -d); mkdir -p "$T/u/applications" "$T/prefs"
printf '[Desktop Entry]\nType=Application\nName=Alpha\nExec=a\n' > "$T/u/applications/alpha.desktop"
ID=org.devos.App.launcher.test
DEV_OS_ROOT=$2 DEV_OS_NATIVE_ID=$ID DEVOS_LAUNCHER_TEST=1 DEVOS_LAUNCHER_DATA_DIRS="$T/u" DEVOS_PREFERENCES_DIR="$T/prefs" NO_AT_BRIDGE=1 "$1" &
PID=$!
call() { gdbus call --session --dest $ID --object-path /org/devos/App/launcher/test/control --method org.devos.Shell.Control.Execute "$1" "/" 2>&1; }
n=0; until call "['launcher','logout']" | grep -q "(0, '')"; do n=$((n+1)); [ $n -gt 40 ] && break; sleep 0.5; done
sleep 1
kill -0 $PID 2>/dev/null && echo "ROUTE logout kept the window open"
echo "ROUTE unknown: $(call "['bogus']" | cut -c1-60)"
call "['launcher']" > /dev/null
sleep 2
kill -0 $PID 2>/dev/null && echo "ROUTE toggle did not close" || echo "ROUTE toggle closed the window"
kill $PID 2>/dev/null; rm -rf "$T"
