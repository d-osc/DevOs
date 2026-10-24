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

Only external apps, including the bundled Chrome and VS Code, use these ranks:

- Five most recently focused applications: `memory.low` soft protection, capped
  at 10% of RAM or 512 MiB per app group.
- Sixth application: half that protection and a bounded, best-effort
  `process_madvise(MADV_WILLNEED)` prefetch when at least 25% of RAM is available.
  Prefetch is limited to 8 MiB per cycle and runs once on entering standby.
- Seventh and older: no protection. When available RAM falls below 20% and swap
  has space, reclaim at most 32 MiB every five seconds, oldest groups first.
  `memory.reclaim` uses a swap preference, not a guarantee of full eviction.
- No hard per-app memory limit, process suspension, or automatic swap file on USB.

`devos-zram.service` creates compressed lz4 swap with logical capacity equal to
half of RAM, capped at 8 GiB. It preserves existing zram swap and other swap
devices. The backing memory is allocated as used, not reserved at boot.
`devos-memory.service` reads a bounded, fresh per-user MRU snapshot and only
handles `devos-app-*` user services. Unranked and stale groups lose protection.

Applications opened from Applications and App Store launch inside transient
systemd user services, retaining child processes in the same memory group.
The original desktop entry handles its Exec arguments and quoting via GIO.
Native DevOs tools sharing the shell process remain together; they cannot be
swapped separately without moving them to separate processes. Apps started
elsewhere, existing singleton processes and D-Bus-activated apps outside the
managed group continue under the kernel's normal memory policy. If the user
manager is unavailable, app launch still works without custom memory ranking.

Requirements: cgroup v2 memory controller, systemd user manager, CONFIG_SWAP,
CONFIG_MEMCG, zram/lz4 and CONFIG_ADVISE_SYSCALLS. Older kernels may reject
prefetch or reclaim hints; those hints fail without terminating applications.

Diagnostics after boot:

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
