#!/bin/sh
# Runs only against a temporary D-Bus/X server created by the test runner.
set -eu
root=$1
export DEV_OS_ROOT="$root" DEV_OS_NATIVE_ID=org.devos.App.taskmanager.NativeTest NO_AT_BRIDGE=1 G_DEBUG=fatal-warnings
"$root/dist/native/taskmanager" &
first=$!
second=
cleanup() { kill "$first" ${second:+"$second"} 2>/dev/null || true; wait "$first" 2>/dev/null || true; }
trap cleanup EXIT HUP INT TERM
attempt=0
while ! gdbus call --session --dest "$DEV_OS_NATIVE_ID" --object-path /org/devos/App/taskmanager/NativeTest/control \
    --method org.devos.Shell.Control.Execute "['task-manager']" "$root" > /dev/null 2>&1; do
    attempt=$((attempt+1)); [ "$attempt" -lt 100 ] || exit 1
    sleep 0.05
done
owner=$(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.GetNameOwner "$DEV_OS_NATIVE_ID")
"$root/dist/native/taskmanager" &
second=$!
wait "$second"
second=
after=$(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.GetNameOwner "$DEV_OS_NATIVE_ID")
[ "$owner" = "$after" ]
gdbus call --session --dest "$DEV_OS_NATIVE_ID" --object-path /org/devos/App/taskmanager/NativeTest/control \
    --method org.devos.Shell.Control.Execute "['task-manager']" "$root" | grep '(0,' > /dev/null
printf '%s\n' 'PASS native Task Manager D-Bus command routing and singleton ownership'
