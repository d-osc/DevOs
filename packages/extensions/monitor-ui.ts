import {
    type UIContext, type Cleanup, type Gdk
} from '@dev-os/core';

export function monitorUI<T extends {destroy(): void}>(context: UIContext,
    create: (monitor: Gdk.Monitor) => T): {values(): T[]; destroy: Cleanup} {
    const surfaces = new Map<Gdk.Monitor, T>();
    const clear = () => { for (const surface of surfaces.values()) surface.destroy(); surfaces.clear(); };
    const reconcile = () => {
        const monitors = context.monitors();
        for (const [monitor, surface] of surfaces) if (!monitors.includes(monitor)) {
            surface.destroy(); surfaces.delete(monitor);
        }
        for (const monitor of monitors) if (!surfaces.has(monitor)) surfaces.set(monitor, create(monitor));
    };
    try { reconcile(); } catch (error) { clear(); throw error; }
    context.onMonitors(reconcile);
    context.onReload(() => { clear(); reconcile(); });
    return {values: () => [...surfaces.values()], destroy: clear};
}
