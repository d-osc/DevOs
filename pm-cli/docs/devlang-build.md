# dev — how the DevLang CLI works

`pm-cli` is the whole of the `dev` command. It was a Rust program until 0.7.0 and is now DevLang (`.dev`) only: the store layout, the registry,
snapshots, shims and the Dev OS extension layout are the ones the Rust build wrote, so a store made by either reads in the other.

## Running

```sh
d main.dev -- <command> [options]     # direct
./dev <command> [options]             # through the launcher script
sh install.sh                         # install to ~/.local (dev on PATH)
```

Subcommands: `install` (`add`, `i`), `list` (`--json`), `info`, `verify`, `remove` (`uninstall`, `un`, `rm`; `--purge` for extensions), `rollback`, `run`,
`pack`, `update`, `self-update`, `catalog`, `search`. Global options `--root`, `--devos-data` and `--applications`; environment `DEV_ROOT`, `XDG_DATA_HOME`, `DEV_BIN_DIR`,
`DEVOS_APPSTORE_DATABASE` (shared catalog), `DEV_UPDATE_API`, `DEV_LAUNCHER` (the path written into launcher entries' `Exec=`).

## Why it shells out

The DevLang runtime caps in-memory data at 8 MiB and has no flock/chmod/symlink APIs, so archives and downloads go through the standard tools
(`tar`, `ar`, `cpio`, `gzip`/`xz`/`zstd`/`bzip2`, `sha256sum`, `curl`) while every security decision stays in DevLang:

- **Extraction**: each member name is validated (`safe_path`, duplicates, case conflicts, types, size and count limits) before anything is written, and
  the extracted tree is cross-checked against the validated listing afterwards. An `.rpm` is read header-first (`tail | head | od` for the lead,
  signature header and metadata header), then its payload streams through the decompressor into `cpio` twice: once to list, once to extract. Links and
  special files are dropped; an archive with a member below one of its own symlinks is refused.
- **Hashing** happens after a download lands; nothing is installed or executed before the digest matches.
- **Store lock**: write operations take a `.dev-lock` marker carrying the pid (a marker whose process is gone is reclaimed). Registry writes are atomic
  rename-over, so readers never see a torn state.
- **`dev run`** captures the child's output and replays it when it exits (the runtime has no inherit mode). The exit status is exact and GUI apps are
  unaffected, but interactive command-line programs do not stream.
- **Progress** is plain lines on stderr; there is no spinner. There are no `fsync` calls.
- **`self-update`** swaps the source tree under `$XDG_DATA_HOME/devos/dev-cli/current` (or `$DEV_CLI_ROOT`) with the `dev-cli.tar.gz` asset of the latest
  release, after running the staged tree's `--version`.

## Layout

| File | What it holds |
| --- | --- |
| `main.dev` | CLI parsing and dispatch |
| `util.dev` | errors, shell access, ids, semver, `safe_path` |
| `archive.dev` | hardened extraction for `.dpk` / `.dpkx` / `.tar.gz`, `.deb` (via `ar`) and `.rpm` (via `cpio`) |
| `manifest.dev` | `package.json` manifest and release templates |
| `store.dev` | store, registry, install / remove / rollback / verify / run / pack, extension flows |
| `devosx.dev` | Dev OS extension manifest rules and store layout |
| `desktop.dev` | XDG `.desktop` entries and the generic launcher icon |
| `shim.dev` | PATH command shims |
| `download.dev` | HTTP(S) downloads |
| `update.dev` | GitHub releases update and self-update |
| `progress.dev` | stage / notice output |

The App Store calls the same CLI catalog and installed registry. `packages[name].catalog`
is an optional package association committed under the PM lock, preserved through
replace/rollback, and removed with the package. `pm-cli/stage.sh` bundles the canonical
`app-db` reader and authoring data as `catalog-data/` for deployment.
