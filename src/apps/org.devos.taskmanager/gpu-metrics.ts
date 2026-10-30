export interface GpuClient {
    id: string;
    device: string;
    engines: Record<string, {busy: bigint; capacity: number}>;
    memory: number | null;
}

/** Linux DRM fdinfo counters; unknown driver fields are intentionally ignored. */
export function gpuClient(text: string): GpuClient | null {
    const driver = /^drm-driver:\s*(\S+)/m.exec(text)?.[1], client = /^drm-client-id:\s*(\d+)/m.exec(text)?.[1];
    if (!driver || !client) return null;
    const device = /^drm-pdev:\s*(\S+)/m.exec(text)?.[1] || driver;
    const engines: GpuClient['engines'] = {};
    for (const match of text.matchAll(/^drm-engine-([^\s:]+):\s*(\d+)\s+ns\s*$/gm)) {
        const capacity = Number(new RegExp(`^drm-engine-capacity-${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(\\d+)\\s*$`, 'm').exec(text)?.[1] ?? 1);
        if (capacity > 0) engines[match[1]] = {busy: BigInt(match[2]), capacity};
    }
    const regions = new Map<string, number>();
    // Legacy memory-* aliases must not double count resident-* for the same region.
    for (const prefix of ['memory', 'resident']) for (const match of text.matchAll(new RegExp(`^drm-${prefix}-([^\\s:]+):\\s*(\\d+)(?:[ \\t]+(KiB|MiB))?[ \\t]*$`, 'gm')))
        regions.set(match[1], Number(match[2]) * (match[3] === 'MiB' ? 1048576 : match[3] === 'KiB' ? 1024 : 1));
    return {id: `${device}:${client}`, device, engines, memory: regions.size ? [...regions.values()].reduce((sum, value) => sum + value, 0) : null};
}

export function sampleGpu(clients: GpuClient[], previous: Map<string, GpuClient>, seconds: number) {
    const next = new Map<string, GpuClient>(), busy = new Map<string, number>();
    let memory: number | null = null;
    for (const client of clients) {
        if (next.has(client.id)) continue; // dup() and inherited/shared descriptors.
        const old = previous.get(client.id);
        const retained: GpuClient = {...client, engines: {...client.engines}};
        for (const [engine, counter] of Object.entries(client.engines)) {
            const before = old?.engines[engine];
            // Drivers may temporarily report a smaller counter. Keep the high
            // watermark until it catches up, as required by the DRM contract.
            if (before && counter.busy < before.busy) retained.engines[engine] = {...counter, busy: before.busy};
            if (!before || before.capacity !== counter.capacity || seconds <= 0) continue;
            const delta = retained.engines[engine].busy - before.busy;
            const key = `${client.device}:${engine}`;
            busy.set(key, (busy.get(key) ?? 0) + Number(delta) / (seconds * 1e9 * counter.capacity) * 100);
        }
        if (client.memory !== null) memory = (memory ?? 0) + client.memory;
        next.set(client.id, retained);
    }
    // Busiest engine per process, rather than summing unlike engines/devices.
    return {usage: busy.size ? Math.min(100, Math.max(...busy.values())) : null, memory, clients: next};
}
