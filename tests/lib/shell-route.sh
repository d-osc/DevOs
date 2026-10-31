#!/bin/sh
# Run inside `dbus-run-session -- xvfb-run`: starts the native shell (no window) and sends it commands over D-Bus, like `dev-os-shell <command>` does.
# $1 = the executable, $2 = DEV_OS_ROOT, $3 = a log file the worker appends to. Prints one line per check.
T=$(mktemp -d)
ID=org.devos.Shell.stest
DEV_OS_ROOT=$2 DEV_OS_NATIVE_ID=$ID DEVOS_SHELL_TEST=1 DEVOS_SHELL_LOG=$3 XDG_RUNTIME_DIR=$T WAYLAND_DISPLAY=test XDG_CONFIG_HOME=$T/config HOME=$T NO_AT_BRIDGE=1 "$1" &
PID=$!
call() { gdbus call --session --dest $ID --object-path /org/devos/Shell/stest/control --method org.devos.Shell.Control.Execute "$1" "/work" 2>&1; }
n=0; until call "['shell']" | grep -q "(0, '')"; do n=$((n+1)); [ $n -gt 40 ] && break; sleep 0.5; done
echo "ROUTE shell: $(call "['shell']")"
call "['settings.wifi']" > /dev/null
call "['launcher']" > /dev/null
call "['editor','a.txt','file:///tmp/b%20c']" > /dev/null
echo "ROUTE unknown: $(call "['bogus']" | cut -c1-60)"
sleep 1
kill -0 $PID 2>/dev/null && echo "ROUTE still running"
call "['session.quit']" > /dev/null
n=0; while kill -0 $PID 2>/dev/null; do n=$((n+1)); [ $n -gt 20 ] && break; sleep 0.5; done
kill -0 $PID 2>/dev/null && echo "ROUTE quit did not end the shell" || echo "ROUTE quit ended the shell"
kill $PID 2>/dev/null; rm -rf "$T"
