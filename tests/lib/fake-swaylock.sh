#!/bin/sh
# Stands in for swaylock: answers --help like the patched one, logs how it was started, reports readiness on stdout and stays up for a few seconds.
if [ "$1" = --help ]; then echo '--ready-fd DEV_OS_LOCK_COVER'; exit 0; fi
printf '%s|%s|%s\n' "$*" "$DEV_OS_LOCK_CLOCK" "$DEV_OS_LOCK_COVER" >> "$0.log"
echo ready
sleep 4
