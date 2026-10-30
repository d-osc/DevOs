import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gpuClient, sampleGpu} from '../src/apps/org.devos.taskmanager/gpu-metrics.ts';

const client = (busy, extra = '', id = 7, device = '0000:01:00.0') => gpuClient(`drm-driver: demo\ndrm-pdev: ${device}\ndrm-client-id: ${id}\ndrm-engine-render: ${busy} ns\n${extra}`);
test('GPU parser distinguishes unknown data from idle usage and resident memory aliases', () => {
    assert.equal(gpuClient('pos: 0\nflags: 00\n'), null);
    assert.equal(gpuClient('drm-driver: demo\n'), null);
    const parsed = client(0, 'drm-memory-vram: 10 MiB\ndrm-resident-vram: 8 MiB\ndrm-resident-gtt: 16 KiB\ndrm-total-vram: 999 MiB\n');
    assert.equal(parsed.memory, 8 * 1048576 + 16 * 1024);
    const first = sampleGpu([parsed], new Map(), 2);
    assert.equal(first.usage, null);
    assert.equal(sampleGpu([parsed], first.clients, 2).usage, 0);
    assert.deepEqual(sampleGpu([], first.clients, 2), {usage: null, memory: null, clients: new Map()});
});
test('Duplicate descriptors do not multiply utilization or GPU memory', () => {
    const initial = client(100, 'drm-resident-vram: 1 MiB\n');
    const baseline = sampleGpu([initial, initial], new Map(), 2);
    const next = client(1000000100, 'drm-resident-vram: 1 MiB\n');
    const result = sampleGpu([next, next], baseline.clients, 2);
    assert.equal(result.usage, 50);
    assert.equal(result.memory, 1048576);
});
test('Busiest engine sums clients on a device and normalizes multi-engine capacity', () => {
    const a = client(0, 'drm-engine-capacity-render: 2\ndrm-engine-copy: 0 ns\n');
    const b = client(0, 'drm-engine-capacity-render: 2\n', 8);
    const baseline = sampleGpu([a, b], new Map(), 1);
    const result = sampleGpu([client(1000000000, 'drm-engine-capacity-render: 2\ndrm-engine-copy: 100000000 ns\n'), client(500000000, 'drm-engine-capacity-render: 2\n', 8)], baseline.clients, 1);
    assert.equal(result.usage, 75);
});
test('Counter regression retains the high watermark and large nanosecond counters keep precision', () => {
    const start = 9007199254740993000n;
    const baseline = sampleGpu([client(start)], new Map(), 1);
    const regressed = sampleGpu([client(start - 100n)], baseline.clients, 1);
    assert.equal(regressed.usage, 0);
    assert.equal(sampleGpu([client(start + 500000000n)], regressed.clients, 1).usage, 50);
    assert.equal(sampleGpu([client(start + 500000000n)], new Map(), 1).usage, null, 'new process/client identities require a baseline');
});
