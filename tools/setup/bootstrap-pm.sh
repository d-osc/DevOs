#!/bin/sh
# Keep DevOsPM's dev CLI in the project runtime, separate from DevLang's dev alias.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
source_root=${DEV_OS_PM_SOURCE:-"$project_root/packages/devospm"}
prefix="$project_root/build/wsl/bin"
if [ -x "$prefix/dev" ] && "$prefix/dev" --version 2>/dev/null | grep -Eq '^dev [0-9]+\.[0-9]+\.[0-9]+'; then
    if [ ! -d "$source_root/src" ] || ! find "$source_root/src" "$source_root/Cargo.toml" "$source_root/Cargo.lock" -type f -newer "$prefix/dev" -print -quit | grep -q .; then exit 0; fi
fi
if [ ! -f "$source_root/Cargo.toml" ]; then
    printf '%s\n' 'DevOsPM source is missing. Set DEV_OS_PM_SOURCE to its checkout.' >&2
    exit 1
fi
cargo_bin=$(command -v cargo || true)
if [ -z "$cargo_bin" ] && [ -x "$HOME/.cargo/bin/cargo" ]; then cargo_bin="$HOME/.cargo/bin/cargo"; fi
if [ -z "$cargo_bin" ]; then printf '%s\n' 'Cargo is required to build the dev package manager for WSL.' >&2; exit 1; fi
(cd "$source_root" && "$cargo_bin" build --release --locked)
binary="$source_root/target/release/dev"
if ! "$binary" --version | grep -Eq '^dev [0-9]+\.[0-9]+\.[0-9]+'; then printf '%s\n' 'The build is not the dev package manager.' >&2; exit 1; fi
mkdir -p "$prefix"
install -m 755 "$binary" "$prefix/dev"
printf 'Package manager ready: %s/dev\n' "$prefix"
