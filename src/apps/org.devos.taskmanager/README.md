# Task Manager

Data is collected in the private app service. The UI renders snapshots and sends
filter, sorting and termination requests.

Process names identify DevOs GJS roles, for example `App Store · UI`,
`App Store · Service` and `DevOs · Desktop`. Hover a row to inspect the original
command; searches also match the command and executable. Rows remain individual
processes, not combined application totals. PID/start-time checks still protect
termination from PID reuse.

- Memory: resident memory, as before.
- GPU / Mem: busiest DRM engine utilization and resident GPU buffer memory from
  `/proc/PID/fdinfo/FD`. This includes system/shared buffer memory, not just dedicated
  VRAM. Client IDs deduplicate repeated descriptors within a process. Shared
  clients may still appear under multiple owning processes. Utilization requires
  two samples of `drm-engine-*` nanosecond counters and accounts for engine capacity;
  drivers that expose only other counter formats remain unavailable. Temporary
  counter regressions retain the previous high watermark. See the
  [kernel DRM usage statistics contract](https://www.kernel.org/doc/html/latest/gpu/drm-usage-stats.html).
- Swap: `VmSwap` from `/proc/PID/status` (private anonymous memory swapped out).
- Disk R/W: changes in `read_bytes` / `write_bytes` from `/proc/PID/io`, in bytes
  per second; cached reads are excluded. Requires kernel task I/O accounting and
  permission to read the process counters. The DevOs kernel fragment enables it.
- TCP network: socket payload counter changes from `ss -tinpeHO`, in bytes per
  second, attributed to socket-owning processes. UDP and connections that open
  and close between samples are not measured. Shared sockets appear under each
  owner and should not be summed across processes. Other users' traffic remains
  unavailable. Requires `ss` from iproute2.

`—` means unavailable or the initial rate sample is warming up; it does not mean
zero. On the current WSL kernel `/proc/PID/io` is absent, so Disk R/W shows `—`.
Changing the DevOs kernel fragment does not change that running WSL kernel.
WSL's dxg interface currently provides no compatible per-process DRM counters in
this environment, so GPU values show `—`; they do not fall back to CPU usage.
Metrics use monotonic elapsed time and process/socket identities. Each refresh
replaces the caches, pruning exited processes and closed sockets.

Validation:

```sh
node tests/process-metrics.test.mjs
node tests/gpu-metrics.test.mjs
npm run build
DEV_OS_ROOT="$PWD" gjs -m dist/process-metrics-live-test.js
d tools/test/base-app-services-smoke.dev -- --tests task-manager-test
```

The live test generates local TCP traffic and temporary-file writes. On kernels
without disk accounting it verifies the unavailable state instead of asserting
real disk throughput.
