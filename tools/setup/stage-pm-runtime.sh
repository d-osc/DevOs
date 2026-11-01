#!/bin/sh
# Bundle the PM and shared catalog beside a staged desktop, with relocatable launchers.
set -eu
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
target=${1:?Usage: stage-pm-runtime.sh DESKTOP_ROOT}
target=$(CDPATH= cd -- "$target" && pwd)
sh "${DEV_OS_PM_SOURCE:-$source_root/pm-cli}/stage.sh" "$target/pm-cli"
mkdir -p "$target/build/wsl/bin"
cat > "$target/build/wsl/bin/dev" <<'EOF'
#!/bin/sh
bindir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$bindir/../../.." && pwd)
DEV_LAUNCHER="$bindir/dev" exec "$bindir/d" "$root/pm-cli/main.dev" -- "$@"
EOF
chmod 755 "$target/build/wsl/bin/dev"
