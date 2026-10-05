#!/bin/sh
# Keep the virtual pointer alive long enough for GTK to receive a real press
# and send its window-menu request before release/device removal.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
python3 - "$project_root" <<'PY'
import hashlib, io, pathlib, sys, tarfile, urllib.request
base = pathlib.Path(sys.argv[1]) / 'build/wsl'
base.mkdir(parents=True, exist_ok=True)
archive = base / 'wlrctl_0.2.2.orig.tar.gz'
if not archive.exists():
    archive.write_bytes(urllib.request.urlopen('https://archive.ubuntu.com/ubuntu/pool/universe/w/wlrctl/wlrctl_0.2.2.orig.tar.gz', timeout=30).read())
data = archive.read_bytes()
if hashlib.sha256(data).hexdigest() != '9d0654e0a3df08162ec893cde95fb0c46a708df22f3df4629c81e0d37ca87901':
    raise SystemExit('Unexpected wlrctl source checksum')
source = base / 'wlrctl-source'
if not (source / 'wlrctl-0.2.2/pointer.c').exists():
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as bundle:
        bundle.extractall(source, filter='data')
PY
source_dir="$project_root/build/wsl/wlrctl-source/wlrctl-0.2.2"
build_dir="$project_root/build/wsl/wlrctl-build"
pointer_patch="$project_root/tools/setup/patches/wlrctl-pointer-lifetime.patch"
if ! git -C "$source_dir" apply --reverse --check "$pointer_patch" 2>/dev/null; then
    git -C "$source_dir" apply --check "$pointer_patch"
    git -C "$source_dir" apply "$pointer_patch"
fi
if [ ! -f "$build_dir/build.ninja" ]; then
    meson setup "$build_dir" "$source_dir"
fi
meson compile -C "$build_dir"
install -m 755 "$build_dir/wlrctl" "$project_root/build/wsl/bin/dev-os-test-pointer"
pointer_build="$project_root/build/native"
mkdir -p "$pointer_build"
wayland-scanner client-header "$project_root/native/protocols/wlr-virtual-pointer-unstable-v1.xml" "$pointer_build/virtual-pointer.h"
wayland-scanner private-code "$project_root/native/protocols/wlr-virtual-pointer-unstable-v1.xml" "$pointer_build/virtual-pointer.c"
cc -std=c11 -O2 -Wall -Wextra -I"$pointer_build" "$project_root/tools/setup/pointer-session.c" "$pointer_build/virtual-pointer.c" \
    $(pkg-config --cflags --libs wayland-client) -o "$project_root/build/wsl/bin/dev-os-test-pointer-session"
