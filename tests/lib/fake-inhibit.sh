#!/bin/sh
# Stands in for systemd-inhibit: runs the command that follows its options.
while [ $# -gt 0 ]; do case "$1" in --*) shift;; *) break;; esac; done
exec "$@"
