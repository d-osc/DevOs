#!/bin/sh
# User-owned daemon, singleton lock and private endpoint discovery. No root is needed.
set -eu
umask 077
case "$0" in */*) script_directory=${0%/*};; *) script_directory=.;; esac
directory=$(CDPATH= cd -- "$script_directory" && pwd)
action=${1:-run}
source=$(realpath -- "${2:-${DEVOS_APPSTORE_DATABASE:-$directory}}")
runner=${3:-${DEVLANG_RUN:-$(command -v devrun || command -v d)}}
runtime=${DEVOS_APP_DB_RUNTIME:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}/devos-app-db-$(id -u)}/devos-app-db}
[ ! -L "$runtime" ] || { echo 'app-db runtime must not be a symlink' >&2; exit 1; }
mkdir -p "$runtime"
[ -O "$runtime" ] || { echo 'app-db runtime must belong to the current user' >&2; exit 1; }
chmod 700 "$runtime"
key=$(printf '%s' "$source" | sha256sum | cut -c1-64)
endpoint=$runtime/$key.json
case "$action" in
    daemon)
        exec flock -n "$endpoint.lock" sh -c 'rm -f -- "$3" "$3.pid"; exec "$1" "$2/service.dev" -- --source "$4" --endpoint "$3"' sh "$runner" "$directory" "$endpoint" "$source"
        ;;
    run)
        exec flock "$endpoint.lock" sh -c 'rm -f -- "$3" "$3.pid"; exec "$1" "$2/service.dev" -- --source "$4" --endpoint "$3"' sh "$runner" "$directory" "$endpoint" "$source"
        ;;
    ensure|start)
        nohup sh "$directory/service.sh" daemon "$source" "$runner" >>"$endpoint.log" 2>&1 </dev/null &
        count=0
        while [ ! -s "$endpoint" ]; do
            count=$((count + 1))
            if [ "$count" -gt 100 ]; then echo "app-db did not start; see $endpoint.log" >&2; exit 1; fi
            sleep 0.05
        done
        printf '%s\n' "$endpoint"
        ;;
    stop)
        if [ -f "$endpoint.pid" ]; then
            pid=$(cat "$endpoint.pid")
            case "$pid" in ''|*[!0-9]*) exit 1;; esac
            if [ -r "/proc/$pid/cmdline" ] && tr '\0' '\n' <"/proc/$pid/cmdline" | grep -Fx -- "$directory/service.dev" >/dev/null && tr '\0' '\n' <"/proc/$pid/cmdline" | grep -Fx -- "$source" >/dev/null; then
                kill "$pid"
                count=0
                while kill -0 "$pid" 2>/dev/null && [ "$count" -lt 100 ]; do count=$((count + 1)); sleep 0.02; done
            fi
        fi
        ;;
    *) echo 'Usage: service.sh run|start|ensure|stop [SOURCE] [DEVRUN]' >&2; exit 2;;
esac
