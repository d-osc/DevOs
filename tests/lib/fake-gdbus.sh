#!/bin/sh
# Stands in for `gdbus monitor` on logind: the first call announces the sleep, the second the wake-up (then each keeps the pipe open like the real one).
n=$(cat "$0.count" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$0.count"
if [ "$n" = 1 ]; then state=true; else state=false; fi
echo "/org/freedesktop/login1: org.freedesktop.login1.Manager.PrepareForSleep ($state,)"
sleep 30
