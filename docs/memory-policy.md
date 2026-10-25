# Application memory policy

DevOs uses soft priorities rather than pinning whole applications or freezing
background work. The kernel still decides which individual pages remain resident.

System applications are excluded from the external MRU ranking. The native shell
and its shared tools (Settings, Files, Terminal, Editor, Task Manager, Disk Manager
and App Store) run in a `devos-system-*.scope` with `MemorySwapMax=0` and a bounded
256 MiB `MemoryLow` reservation. Anonymous memory in this scope cannot be swapped;
clean file-backed pages can still be reclaimed. This does not pin every page or
disable swap globally. Terminal child commands inherit this system scope unless
launched separately. Without a systemd user manager the session still starts and
prints that this policy could not be applied.

Only external (third-party) apps use these ranks:

- Five most recently focused applications: `memory.low` soft protection, capped
  at 10% of RAM or 512 MiB per app group.
- Sixth application: half that protection and a bounded, best-effort
  `process_madvise(MADV_WILLNEED)` prefetch when at least 25% of RAM is available.
  Prefetch is limited to 8 MiB per cycle and runs once on entering standby.
- Seventh and older: no protection. When available RAM falls below 20% and swap
  has space, reclaim at most 32 MiB every five seconds, oldest groups first.
  `memory.reclaim` uses a swap preference, not a guarantee of full eviction.
- No hard per-app memory limit, process suspension, or automatic swap file on USB.

`devos-zram.service` (`/usr/libexec/devos-swap apply`) sets up swap at every boot from `/etc/devos/swap.conf`. Without that file the
default is compressed RAM swap (zram) with a nominal size **equal to RAM**, zstd compression (lz4 when the kernel has no zstd backend)
and `vm.swappiness=100`. The backing memory is allocated as pages are swapped out and the compressed data takes roughly a third of
the swapped amount; a `mem_limit` of 60% of RAM stops zram from ever taking more than that. Swap is changed in Settings > System > Power &
battery > Memory & swap (zram, a swap file on an installed disk, or off; 25-200% of RAM or a custom size up to twice the RAM; see
`docs/system.md`). Other swap devices are left alone. `devos-memory.service` reads a bounded, fresh per-user MRU snapshot and only
handles `devos-app-*` user services. Unranked and stale groups lose protection. With no managed apps it wakes every 30 s instead of 5 s.

`/etc/sysctl.d/90-devos-memory.conf` tunes the rest: `vm.page-cluster=0` (zram reads one page at a time), `vm.vfs_cache_pressure=50`,
`vm.watermark_boost_factor=0` and `vm.watermark_scale_factor=125` (earlier background reclaim, fewer direct-reclaim stalls) and
`vm.dirty_background_bytes=32M` / `vm.dirty_bytes=128M` so that a slow USB stick cannot pile up gigabytes of dirty pages and freeze
every program that writes.

## Who is killed first

When memory really runs out the kernel OOM killer picks by `oom_score`. Applications started from the launcher run as
`devos-app-*.service` with `OOMScoreAdjust=300`, `CPUWeight=80` and `IOWeight=80`, so they go before the desktop; the shell
scope has `CPUWeight=200` / `IOWeight=200` and no swap (`MemorySwapMax=0`), the compositor and greeter run at the default 0.
Background helpers (`devos-speaker`, `devos-microphone`, `devos-keyboard-backlight`, `devos-touchpad-gestures`,
`devos-smartconnect`) run at `Nice=10`, `CPUWeight=20`, `IOWeight=20`, `OOMScoreAdjust=300` with `MemoryHigh` / `MemoryMax` limits.
The cpu and io weights only take effect where systemd delegates those controllers to the user manager; the OOM and Nice settings always do.
There is no earlyoom or systemd-oomd in the image: if memory runs out, the kernel kills an app (adjust 300) first and the supervisor
restarts a killed shell (see Session recovery).

**Live USB.** The root file system is an overlay whose upper layer is a tmpfs created by the initramfs without a `size=` (so up to 50% of RAM).
Everything written in a Live session (downloads, caches, installed packages) therefore uses RAM, but tmpfs pages can be swapped to zram
like any other. That is why a swap file on disk is refused there.

Applications opened from Applications and App Store launch inside transient
systemd user services, retaining child processes in the same memory group.
The original desktop entry handles its Exec arguments and quoting via GIO.
Native DevOs tools sharing the shell process remain together; they cannot be
swapped separately without moving them to separate processes. Apps started
elsewhere, existing singleton processes and D-Bus-activated apps outside the
managed group continue under the kernel's normal memory policy. If the user
manager is unavailable, app launch still works without custom memory ranking.

Requirements: cgroup v2 memory controller, systemd user manager, CONFIG_SWAP,
CONFIG_MEMCG, zram with the zstd (preferred) or lz4 backend and CONFIG_ADVISE_SYSCALLS. Older kernels may reject
prefetch or reclaim hints; those hints fail without terminating applications.

Diagnostics after boot (`sh /usr/libexec/devos-swap get` prints the same numbers Settings shows):

```sh
swapon --show
zramctl
systemctl status devos-zram devos-memory
systemctl --user list-units 'devos-app-*'
cat "$XDG_RUNTIME_DIR/devos-memory-policy.json"
```

Tests: `python3 tests/memory-policy.test.py`; opt-in real transient service
test: `DEVOS_MEMORY_INTEGRATION=1 python3 tests/memory-policy.test.py`.

## Session recovery

If the shell dies while labwc keeps running, the screen shows only labwc's root menu. `packages/supervisor` therefore
restarts a shell that was killed by a signal (for example an OOM kill) or exited non-zero, one second later, up to five
times in five minutes; after that it ends the session so greetd returns instead of leaving an empty desktop. Exit status
0 (logout, version switch, SIGTERM) is never restarted. `bin/dev-os-start` applies the same rule to the supervisor itself:
if its scope is killed while labwc is alive, the supervisor is started again (five times in five minutes, then labwc is
stopped).
