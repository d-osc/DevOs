import {
    Gio
} from '@dev-os/core';

let catalog: Gio.AppInfo[] | undefined;
let visibleCatalog: Gio.AppInfo[] | undefined;
let monitor: Gio.AppInfoMonitor | undefined;
const compareNames = new Intl.Collator().compare;
let metadata = new WeakMap<SearchableApp, {name: string; text: string}>();

// Share one scan between the launcher and every panel/monitor. GIO invalidates
// it when desktop entries change, so installing apps needs no shell restart.
export function desktopApps(): Gio.AppInfo[] {
    if (!monitor) {
        monitor = Gio.AppInfoMonitor.get();
        monitor.connect('changed', () => {
            catalog = undefined; visibleCatalog = undefined; metadata = new WeakMap();
        });
    }
    return catalog ??= Gio.AppInfo.get_all();
}
export function installedApps(): Gio.AppInfo[] {
    const apps = desktopApps();
    return visibleCatalog ??= apps.filter(app => app.should_show())
        .sort((a, b) => compareNames(appMetadata(a).name, appMetadata(b).name));
}

interface DesktopAppIdentity {
    get_id(): string | null;
    get_startup_wm_class?(): string | null;
}
export function findDesktopApp<T extends DesktopAppIdentity>(apps: readonly T[], appId: string): T | undefined {
    const normalized = appId.trim().toLowerCase();
    if (!normalized) return undefined;
    const desktopId = normalized.endsWith('.desktop') ? normalized : `${normalized}.desktop`;
    return apps.find(app => app.get_id()?.toLowerCase() === desktopId)
        ?? apps.find(app => app.get_startup_wm_class?.()?.toLowerCase() === normalized);
}

export interface SearchableApp {
    get_display_name(): string; get_description(): string | null; get_id(): string | null;
    get_keywords?(): string[] | null;
}
function appMetadata(app: SearchableApp) {
    let cached = metadata.get(app);
    if (!cached) {
        cached = {name: app.get_display_name().toLowerCase(),
            text: [app.get_display_name(), app.get_description() ?? '', app.get_id() ?? '',
                ...(app.get_keywords?.() ?? [])].join(' ').toLowerCase()};
        metadata.set(app, cached);
    }
    return cached;
}
export function searchApps<T extends SearchableApp>(apps: readonly T[], query: string): T[] {
    const normalized = query.toLowerCase().trim();
    const terms = normalized.split(/\s+/).filter(Boolean);
    return apps.filter(app => {
        const {text} = appMetadata(app);
        return terms.every(term => text.includes(term));
    }).sort((a, b) => {
        const nameA = appMetadata(a).name;
        const nameB = appMetadata(b).name;
        return Number(nameB.startsWith(normalized)) - Number(nameA.startsWith(normalized)) ||
            compareNames(nameA, nameB);
    });
}
