#!/bin/sh
# make-rpm.sh OUT TREE NAME VERSION [gzip|xz|zstd|bzip2|none]
# Builds a minimal but well-formed .rpm without rpmbuild: the 96-byte lead, an empty signature header, a metadata header with the tags dev reads
# (name, version, release, summary, payload format and compressor) and a newc cpio payload of TREE compressed as asked.
set -eu
out=$1; tree=$2; name=$3; version=$4; compression=${5:-gzip}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

be32() { # value -> four big-endian bytes
    printf "\\$(printf %03o $(( ($1 >> 24) & 255 )))\\$(printf %03o $(( ($1 >> 16) & 255 )))\\$(printf %03o $(( ($1 >> 8) & 255 )))\\$(printf %03o $(( $1 & 255 )))"
}

entries="$work/entries"; data="$work/data"; : > "$entries"; : > "$data"
count=0; offset=0
add_string() { # tag type text
    be32 "$1" >> "$entries"; be32 "$2" >> "$entries"; be32 "$offset" >> "$entries"; be32 1 >> "$entries"
    printf '%s\0' "$3" >> "$data"
    offset=$(( offset + ${#3} + 1 )); count=$(( count + 1 ))
}
add_string 1000 6 "$name"
add_string 1001 6 "$version"
add_string 1002 6 "1"
add_string 1004 9 "A $name test package"
add_string 1124 6 "cpio"
case $compression in
    none) ;;
    *) add_string 1125 6 "$compression" ;;
esac

{
    printf '\355\253\356\333\003\000\000\000\000\001'; head -c 86 /dev/zero               # lead: magic, version, type, arch, name, OS, signature type, reserved
    printf '\216\255\350\001\000\000\000\000'; be32 0; be32 0                                # signature header with no entries
    printf '\216\255\350\001\000\000\000\000'; be32 "$count"; be32 "$offset"                # metadata header
    cat "$entries" "$data"
    # RPM_LIST (names, one per line) replaces the tree walk: it lets a test archive a path below a symlink
    (cd "$tree" && { if [ -n "${RPM_LIST:-}" ]; then printf '%s
' "$RPM_LIST"; else find . | sort; fi; } | cpio -o -H newc --quiet) | case $compression in
        gzip) gzip -c ;; xz) xz -c ;; zstd) zstd -c -q ;; bzip2) bzip2 -c ;; none) cat ;;
    esac
} > "$out"
