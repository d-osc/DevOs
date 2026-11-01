#!/bin/sh
# Portable CLI payload. Its catalog is always authored in app-db.
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
target=${1:?Usage: stage.sh TARGET_DIRECTORY}
mkdir -p "$target"
target=$(CDPATH= cd -- "$target" && pwd -P)
[ "$target" != / ] && [ "$target" != "$project" ] || exit 2
database=${DEVOS_APPSTORE_SOURCE:-}
if [ -z "$database" ]; then
    if [ -f "$project/catalog-data/database-cli.dev" ]; then database=$project/catalog-data
    else database=$project/../app-db; fi
fi
[ -f "$database/database-cli.dev" ] && [ -d "$database/apps" ] || { echo "Missing shared app-db database: $database" >&2; exit 2; }
for name in main archive catalog desktop devosx download manifest progress shim store update util; do
    cp "$project/$name.dev" "$target/$name.dev"
done
cp "$project/LICENSE" "$target/LICENSE"
cp "$project/stage.sh" "$target/stage.sh"
next=$(mktemp -d "$target/.catalog-data-XXXXXX")
trap 'rm -rf "$next"' EXIT HUP INT TERM
cp "$database/database.dev" "$database/database-cli.dev" "$next/"
mkdir -p "$next/apps"
cp -R "$database/apps/." "$next/apps/"
if [ -d "$database/extensions" ]; then mkdir -p "$next/extensions"; cp -R "$database/extensions/." "$next/extensions/"; fi
old=$target/.catalog-old-$$
[ ! -e "$old" ] || exit 2
if [ -e "$target/catalog-data" ]; then mv "$target/catalog-data" "$old"; fi
mv "$next" "$target/catalog-data"
if [ -d "$old" ]; then rm -rf "$old"; fi
