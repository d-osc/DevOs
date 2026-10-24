#!/bin/sh
# Disposable QEMU guest only. These are software regressions, not physical-device tests.
set -eu
testdir=/usr/libexec/devos-live-test
daemon_pid=
cleanup() {
    code=$?
    if [ -n "$daemon_pid" ]; then kill "$daemon_pid" 2>/dev/null || true; wait "$daemon_pid" 2>/dev/null || true; fi
    if [ "$code" -ne 0 ]; then echo DEVOS_DEVICE_REGRESSIONS_FAIL; fi
}
trap cleanup EXIT
echo 'QEMU software regression checks; no physical Wi-Fi/Bluetooth/MIPI camera is attached.'
if systemctl is-enabled --quiet dnsmasq.service || systemctl is-active --quiet dnsmasq.service; then
    echo 'FAIL: standalone dnsmasq must be disabled and inactive for NetworkManager hotspot ownership'; exit 1
fi
echo 'PASS: packaged standalone dnsmasq service is disabled and inactive'
gjs -m "$testdir/bluetooth-controller-test.js"
gjs -m "$testdir/bluetooth-discovery-test.js"
# Reproduce the observed EADDRINUSE using real dnsmasq processes on an isolated
# loopback test port. The second process succeeds once the first owner is gone.
dnsmasq --no-daemon --conf-file=/dev/null --port=1053 --listen-address=127.0.0.1 --bind-interfaces --no-resolv --no-hosts --pid-file=/tmp/devos-dns-test.pid >/tmp/devos-dns-first.log 2>&1 &
daemon_pid=$!
sleep 1
kill -0 "$daemon_pid"
if dnsmasq --no-daemon --conf-file=/dev/null --port=1053 --listen-address=127.0.0.1 --bind-interfaces --no-resolv --no-hosts --pid-file=/tmp/devos-dns-test2.pid >/tmp/devos-dns-second.log 2>&1; then
    echo 'FAIL: duplicate DNS listener was accepted'; exit 1
fi
grep -i 'address already in use' /tmp/devos-dns-second.log
kill "$daemon_pid"; wait "$daemon_pid" || true; daemon_pid=
dnsmasq --no-daemon --conf-file=/dev/null --port=1053 --listen-address=127.0.0.1 --bind-interfaces --no-resolv --no-hosts --pid-file=/tmp/devos-dns-test2.pid >/tmp/devos-dns-recovered.log 2>&1 &
daemon_pid=$!
sleep 1
kill -0 "$daemon_pid"
echo 'PASS: real dnsmasq duplicate-port failure and single-owner recovery (not Wi-Fi AP validation)'
echo DEVOS_DEVICE_REGRESSIONS_PASS
