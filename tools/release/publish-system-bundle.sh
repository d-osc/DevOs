#!/bin/sh
# Attach a system update bundle (kernel, boot image, firmware, system files) to an existing GitHub release and re-sign SHA256SUMS.
# The bundle comes from a local OpenEmbedded build (d tools/release/release.dev -- system ...); GitHub Actions cannot build it.
# Usage: tools/release/publish-system-bundle.sh --tag v0.3.7 --dir build/release --key /path/to/private.pem [--repo d-osc/DevOs] [--dry-run]
#   --dir   directory with dev-os-system-<platform>.tar.gz and dev-os-system-<platform>.json (one or both platforms)
#   --key   Ed25519 private key (never committed); required when data/update-keys/*.pub exists, optional otherwise
set -eu
repo=d-osc/DevOs tag= dir= key= dry=
while [ $# -gt 0 ]; do
    case "$1" in
        --tag) tag=$2; shift 2 ;; --dir) dir=$2; shift 2 ;; --key) key=$2; shift 2 ;; --repo) repo=$2; shift 2 ;; --dry-run) dry=1; shift ;;
        *) echo "Unknown option $1" >&2; exit 2 ;;
    esac
done
[ -n "$tag" ] && [ -d "$dir" ] || { echo "Usage: $0 --tag vX.Y.Z --dir DIR [--key private.pem] [--repo owner/repo] [--dry-run]" >&2; exit 2; }
printf '%s' "$tag" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || { echo "Tag must be vMAJOR.MINOR.PATCH" >&2; exit 2; }
keys=$(ls data/update-keys/*.pub 2>/dev/null || true)
if [ -n "$keys" ] && [ -z "$key" ]; then echo "data/update-keys has a public key: pass --key so SHA256SUMS can be signed again." >&2; exit 1; fi
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
assets=
for file in "$dir"/dev-os-system-linux-*.tar.gz "$dir"/dev-os-system-linux-*.json; do
    [ -f "$file" ] || continue
    size=$(wc -c < "$file")
    [ "$size" -lt 2147483648 ] || { echo "$file exceeds the 2 GiB GitHub release asset limit" >&2; exit 1; }
    assets="$assets $file"
done
[ -n "$assets" ] || { echo "No dev-os-system-linux-*.tar.gz / .json in $dir" >&2; exit 1; }
gh release download "$tag" --repo "$repo" --pattern SHA256SUMS --dir "$work"
[ -f "$work/SHA256SUMS" ] || { echo "Release $tag has no SHA256SUMS" >&2; exit 1; }
for file in $assets; do
    name=$(basename "$file")
    grep -v " $name\$" "$work/SHA256SUMS" > "$work/next" || true
    printf '%s  %s\n' "$(sha256sum "$file" | cut -d' ' -f1)" "$name" >> "$work/next"
    mv "$work/next" "$work/SHA256SUMS"
done
sort -k2 "$work/SHA256SUMS" -o "$work/SHA256SUMS"
upload="$assets $work/SHA256SUMS"
if [ -n "$key" ]; then
    openssl pkeyutl -sign -inkey "$key" -rawin -in "$work/SHA256SUMS" -out "$work/SHA256SUMS.sig"
    ok=
    for pub in $keys; do openssl pkeyutl -verify -pubin -inkey "$pub" -rawin -in "$work/SHA256SUMS" -sigfile "$work/SHA256SUMS.sig" >/dev/null && ok=1; done
    if [ -n "$keys" ] && [ -z "$ok" ]; then echo "The signature does not verify with data/update-keys/*.pub; wrong key?" >&2; exit 1; fi
    upload="$upload $work/SHA256SUMS.sig"
fi
echo "Uploading to $repo $tag:"; for file in $upload; do echo "  $(basename "$file")"; done
[ -z "$dry" ] || { echo "(dry run: nothing uploaded)"; exit 0; }
# shellcheck disable=SC2086
gh release upload "$tag" --repo "$repo" --clobber $upload
