import Gio from 'gi://Gio';

export function installedApps(): Gio.AppInfo[] {
    return Gio.AppInfo.get_all().filter(app => app.should_show())
        .sort((a, b) => a.get_display_name().toLowerCase().localeCompare(b.get_display_name().toLowerCase()));
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
export function searchApps<T extends SearchableApp>(apps: readonly T[], query: string): T[] {
    const normalized = query.toLowerCase().trim();
    const terms = normalized.split(/\s+/).filter(Boolean);
    return apps.filter(app => {
        const keywords = app.get_keywords?.() ?? [];
        const text = [app.get_display_name(), app.get_description() ?? '', app.get_id() ?? '',
            ...keywords].join(' ').toLowerCase();
        return terms.every(term => text.includes(term));
    }).sort((a, b) => {
        const nameA = a.get_display_name().toLowerCase();
        const nameB = b.get_display_name().toLowerCase();
        return Number(nameB.startsWith(normalized)) - Number(nameA.startsWith(normalized)) ||
            nameA.localeCompare(nameB);
    });
}
