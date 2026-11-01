#!/bin/bash
# Stage repo-owned userland; never copy the build host's executables or libraries.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
mode=${1:?Usage: userland.sh busybox|pm|all STAGING_ROOT [aarch64|x86_64]}
stage=${2:?Missing staging root}
arch=${3:-$(uname -m)}
case "$arch" in arm64) arch=aarch64;; amd64) arch=x86_64;; aarch64|x86_64) ;; *) echo "Unsupported architecture: $arch" >&2; exit 2;; esac
case "$stage" in /*) ;; *) echo 'Staging root must be absolute' >&2; exit 2;; esac
[[ $stage != / ]] || exit 2
work=${DEVOS_USERLAND_WORK:-${XDG_CACHE_HOME:-$HOME/.cache}/devos-userland}
mkdir -p "$work/downloads" "$stage"
exec 9>"$work/build-$arch.lock"
flock 9
cc=${DEVOS_USERLAND_CC:-${CC:-cc}}
if [[ $arch != $(uname -m) && -z ${DEVOS_USERLAND_CC:-} ]]; then cc=$arch-linux-gnu-gcc; fi
command -v "$cc" >/dev/null || { echo "Missing target C compiler: $cc" >&2; exit 2; }
host_d=$(sh "$root/packages/react-devlang/tools/toolchain.sh")
fetch() {
    local url=$1 name=$2 digest=$3
    if [[ ! -f $work/downloads/$name ]] || ! printf '%s  %s\n' "$digest" "$work/downloads/$name" | sha256sum -c - >/dev/null 2>&1; then
        curl -fL --retry 3 "$url" -o "$work/downloads/$name.part"
        printf '%s  %s\n' "$digest" "$work/downloads/$name.part" | sha256sum -c - >&2
        mv "$work/downloads/$name.part" "$work/downloads/$name"
    fi
}
check_elf() {
    python3 - "$1" "$arch" <<'PY'
import struct,sys
from pathlib import Path
b=Path(sys.argv[1]).read_bytes()
assert b[:6]==b'\x7fELF\x02\x01', 'Expected a 64-bit little-endian ELF'
assert struct.unpack_from('<H',b,18)[0]=={'aarch64':183,'x86_64':62}[sys.argv[2]], 'Wrong target architecture'
offset=struct.unpack_from('<Q',b,32)[0]; size,count=struct.unpack_from('<HH',b,54)
assert not any(struct.unpack_from('<I',b,offset+i*size)[0] in (2,3) for i in range(count)), 'A static executable is required (no dynamic section/interpreter)'
PY
}
build_dash() {
    fetch https://deb.debian.org/debian/pool/main/d/dash/dash_0.5.12.orig.tar.gz dash-0.5.12.tar.gz 6a474ac46e8b0b32916c4c60df694c82058d3297d8b385b74508030ca4a8f28a
    [[ -d $work/dash-0.5.12 ]] || tar -xzf "$work/downloads/dash-0.5.12.tar.gz" -C "$work"
    local build=$work/dash-build-$arch
    mkdir -p "$build"
    if [[ ! -x $build/src/dash ]]; then
        local host=()
        if [[ $arch != $(uname -m) ]]; then host=(--host="$arch-linux-gnu" --build="$(uname -m)-linux-gnu"); fi
        (cd "$build"; CC="$cc" LDFLAGS=-static "$work/dash-0.5.12/configure" --without-libedit "${host[@]}"; make -j"${DEVOS_USERLAND_JOBS:-4}") >&2
    fi
    check_elf "$build/src/dash"
    install -Dm755 "$build/src/dash" "$stage/usr/libexec/devos/dash"
    install -Dm644 "$work/dash-0.5.12/COPYING" "$stage/usr/share/licenses/dash/COPYING"
}
build_busybox() {
    local project=${DEVOS_BUSYBOX_SOURCE:-$root/busybox-cli}
    [[ -f $project/main.dev && -f $project/build.sh ]] || { echo "Missing busybox-cli project: $project" >&2; exit 2; }
    mkdir -p "$work/busybox-$arch"
    CC="$cc" BUSYBOX_STATIC=1 DEVLANG_D="$host_d" sh "$project/build.sh" "$work/busybox-$arch/busybox"
    check_elf "$work/busybox-$arch/busybox"
    build_dash
    install -Dm755 "$work/busybox-$arch/busybox" "$stage/bin/busybox"
    # Inventory is source metadata, so cross builds never execute target code.
    python3 - "$project/main.dev" "$stage" <<'PY'
import hashlib,json,re,sys
from pathlib import Path
source=Path(sys.argv[1]); root=Path(sys.argv[2])
names=sorted(set(re.findall(r'if sys.same\(name, "([^"]+)"\) \{ return \w+\.\w+\(args\)',source.read_text())))
assert names and 'sh' in names and 'init' in names
for name in names:
    link=root/'bin'/name
    if link.is_symlink(): link.unlink()
    elif link.exists(): raise RuntimeError(f'Refusing to replace an unmanaged applet: {link}')
    link.symlink_to('busybox')
(root/'sbin').mkdir(exist_ok=True)
for name in ('init','mdev','modprobe','poweroff','reboot','halt','syslogd','klogd','udhcpc'):
    link=root/'sbin'/name
    if link.is_symlink(): link.unlink()
    elif link.exists(): raise RuntimeError(f'Refusing to replace an unmanaged applet: {link}')
    link.symlink_to('../bin/busybox')
meta=root/'usr/share/devos-busybox'; meta.mkdir(parents=True,exist_ok=True)
(meta/'applets.txt').write_text('\n'.join(names)+'\n')
record={'project':str(source.parent),'format':'native-static','sha256':hashlib.sha256((root/'bin/busybox').read_bytes()).hexdigest()}
(meta/'provenance.json').write_text(json.dumps(record,indent=2)+'\n')
PY
}
build_runtime() {
    # DevLang release v0.5.6 (its CLI --version still prints 0.5.5 upstream).
    local revision=db4d78c4f9d2992e2e705ad95ecc6d55e3a51ccb
    local source=$work/DevLang-$revision target=$arch-unknown-linux-musl
    local bundle=${DEVOS_DEVLANG_BUNDLE:-$source/target/$target/release}
    if [[ -z ${DEVOS_DEVLANG_BUNDLE:-} && ( ! -x $bundle/d || ! -x $bundle/devrun ) ]]; then
        if ! command -v cargo >/dev/null && [[ -f $HOME/.cargo/env ]]; then source "$HOME/.cargo/env"; fi
        command -v cargo >/dev/null && command -v rustup >/dev/null || { echo 'Install Rust/rustup to build the static DevLang runtime, or set DEVOS_DEVLANG_BUNDLE to a target static bundle.' >&2; exit 2; }
        fetch https://codeload.github.com/d-osc/DevLang/tar.gz/$revision devlang-$revision.tar.gz bf5b6206a334818120a07a1820133f7db12e40e2c4b71c2243aab302ad7f33c4
        [[ -d $source ]] || tar -xzf "$work/downloads/devlang-$revision.tar.gz" -C "$work"
        local muslcc=${DEVOS_MUSL_CC:-}
        if [[ -z $muslcc ]]; then
            local prefix=$work/musl-$arch
            muslcc=$prefix/bin/musl-gcc
            if [[ ! -x $muslcc ]]; then
                fetch https://musl.libc.org/releases/musl-1.2.5.tar.gz musl-1.2.5.tar.gz a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4
                [[ -d $work/musl-1.2.5 ]] || tar -xzf "$work/downloads/musl-1.2.5.tar.gz" -C "$work"
                mkdir -p "$work/musl-build-$arch"
                (cd "$work/musl-build-$arch"; CC="$cc" "$work/musl-1.2.5/configure" --target="$arch-linux-musl" --prefix="$prefix" --disable-shared; make -j"${DEVOS_USERLAND_JOBS:-4}"; make install) >&2
            fi
        fi
        rustup target add "$target" >&2
        local rust_target=${target//-/_} linker=CARGO_TARGET_${target^^}_LINKER
        linker=${linker//-/_}
        (cd "$source"; env "CC_$rust_target=$muslcc" "$linker=$muslcc" RUSTFLAGS="-C link-arg=$($muslcc -print-libgcc-file-name)" cargo build --release --locked --target "$target" -p dev-cli -p dev-runtime --bin d --bin devrun) >&2
    fi
    for binary in d devrun; do check_elf "$bundle/$binary"; install -Dm755 "$bundle/$binary" "$stage/usr/bin/$binary"; done
    # A minimal image only runs scripts; the native compiler devc is not needed.
    local license=$source/LICENSE
    if [[ ! -f $license && -f $bundle/LICENSE ]]; then license=$bundle/LICENSE; fi
    if [[ ! -f $license && -f $bundle/../../../LICENSE ]]; then license=$bundle/../../../LICENSE; fi
    [[ -f $license ]] || { echo 'The DevLang bundle must include LICENSE' >&2; exit 2; }
    install -Dm644 "$license" "$stage/usr/share/licenses/devlang/LICENSE"
    python3 - "$bundle" "$stage/usr/share/licenses/devlang/provenance.json" "$arch" "${DEVOS_DEVLANG_BUNDLE:+external}" "$revision" <<'PYRUNTIME'
import hashlib,json,sys
from pathlib import Path
p=Path(sys.argv[1]); files={name:hashlib.sha256((p/name).read_bytes()).hexdigest() for name in ('d','devrun')}
Path(sys.argv[2]).write_text(json.dumps({'target':sys.argv[3],'files':files,'version':'external' if sys.argv[4] else '0.5.6','sourceRevision':None if sys.argv[4] else sys.argv[5]},indent=2)+'\n')
PYRUNTIME
}
build_pm() {
    local project=${DEV_OS_PM_SOURCE:-$root/pm-cli}
    [[ -f $project/main.dev ]] || { echo "Missing pm-cli project: $project" >&2; exit 2; }
    local version
    version=$("$host_d" "$project/main.dev" -- --version)
    [[ $version == 'dev '* ]] || { echo 'Cannot read pm-cli version' >&2; exit 2; }
    build_runtime
    mkdir -p "$stage/usr/share/devos-pm/cli" "$stage/usr/bin" "$stage/bin" "$stage/var/lib/devos"
    sh "$project/stage.sh" "$stage/usr/share/devos-pm/cli"
    install -m644 "$project/LICENSE" "$stage/usr/share/devos-pm/LICENSE"
    printf '#!/bin/sh\nDEV_LAUNCHER=/usr/bin/dev exec /usr/bin/d /usr/share/devos-pm/cli/main.dev -- "$@"\n' > "$stage/usr/bin/devospm"
    chmod 755 "$stage/usr/bin/devospm"
    ln -sfn devospm "$stage/usr/bin/dev"
    ln -sfn ../usr/bin/dev "$stage/bin/dev"
    if [[ -f $project/examples/greeting-extension/package.json ]]; then
        mkdir -p "$stage/root/packages"
        rm -f -- "$stage/root/packages/greeting-extension-1.0.0.dpk"
        "$host_d" "$project/main.dev" -- pack "$project/examples/greeting-extension" --output "$stage/root/packages/greeting-extension-1.0.0.dpk" >&2
    fi
    printf '%s\n' "${version#dev }" > "$stage/usr/share/devos-pm/version"
    python3 - "$project" "$stage/usr/share/devos-pm/provenance.json" "$stage/usr/share/devos-pm/cli/catalog-data" <<'PY'
import hashlib,json,sys
from pathlib import Path
p=Path(sys.argv[1]); files={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(p.glob('*.dev')) if f.name!='test_modules.dev'}
catalog=Path(sys.argv[3]); catalog_files={str(f.relative_to(catalog)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(catalog.rglob('*')) if f.is_file()}
Path(sys.argv[2]).write_text(json.dumps({'project':str(p),'format':'devlang-sources','files':files,'catalogFiles':catalog_files},indent=2)+'\n')
PY
}
case "$mode" in busybox) build_busybox;; pm) build_pm;; all) build_busybox; build_pm;; *) echo "Unknown mode: $mode" >&2; exit 2;; esac
