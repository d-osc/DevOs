import {registryApps, matchesApp} from '../apps/org.devos.appstore/registry.js';
import {registryExtensions, matchesExtension} from '../apps/org.devos.appstore/registry-extensions.js';
import type {App, StoreState} from '../apps/org.devos.appstore/backend.js';
import type {InstalledPackage} from '../apps/org.devos.appstore/package-backend.js';
import type {RegistryControls} from '../apps/org.devos.appstore/registry-backend.js';
import type {StoreItem} from '../../packages/extensions/store.js';
import type {ProcessState} from '../apps/org.devos.taskmanager/processes.js';

/** Data shaping is centralized in the worker, including search/ranking and joins. */
export async function projectAppView(kind: string, input: any): Promise<any> {
    if (kind === 'processes') {
        const {state, query, sort} = input as {state: ProcessState | null; query: string; sort: string};
        const needle = query.trim().toLowerCase();
        const metric = (item: NonNullable<typeof state>['processes'][number]): number => sort === 'gpu' ? item.gpu ?? -1 : sort === 'gpuMemory' ? item.gpuMemory ?? -1 : sort === 'swap' ? item.swap ?? -1 : sort === 'disk' ? item.diskRead == null && item.diskWrite == null ? -1 : (item.diskRead ?? 0) + (item.diskWrite ?? 0) : sort === 'network' ? item.networkReceive == null && item.networkSend == null ? -1 : (item.networkReceive ?? 0) + (item.networkSend ?? 0) : sort === 'memory' ? item.memory : item.cpu;
        return (state?.processes ?? []).filter(item => !needle || `${item.name} ${item.command ?? ''} ${item.executable ?? ''} ${item.pid} ${item.user}`.toLowerCase().includes(needle))
            .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'pid' ? a.pid - b.pid : metric(b) - metric(a) || b.memory - a.memory);
    }
    if (kind === 'extensions') {
        const catalog = registryExtensions(), {selected, query, items} = input as {selected: any; query: string; items: StoreItem[]};
        return {catalog, items: items.filter(item => selected ? selected.repository?.toLowerCase() === item.repository.toLowerCase() :
            !catalog.some(entry => entry.repository?.toLowerCase() === item.repository.toLowerCase()) && `${item.repository} ${item.release?.manifest.name ?? ''} ${item.installed?.id ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())),
            selectedItem: selected?.repository ? items.find(item => item.repository.toLowerCase() === selected.repository?.toLowerCase()) : undefined,
            results: catalog.filter(entry => matchesExtension(entry, query))};
    }
    if (kind === 'store') {
        const {state, packages, registry, section, query, selected} = input as {state: StoreState | null; packages: InstalledPackage[]; registry?: RegistryControls; section: string; query: string; selected: App | null};
        const registryCatalog = registryApps(), recommended = [...(state?.catalog ?? []), ...registryCatalog];
        const bindings = Object.fromEntries(await Promise.all(registryCatalog.map(async app => [app.registry.id, await registry?.packageId(app.registry.id)])));
        const userApps = packages.filter(item => item.kind === 'app').map(item => {
            const match = registryCatalog.find(app => bindings[app.registry.id] === item.id);
            return {...match, id: match?.id ?? `pm:${item.id}`, name: match?.name ?? item.title, description: match?.description ?? item.description, version: item.version, userPackage: item.id};
        });
        const catalog = new Map(recommended.map(app => [app.id, app]));
        let apps = section === 'Installed' ? [...(state?.installed ?? []).map(app => ({...catalog.get(app.id), ...app})), ...userApps] : section === 'Updates' ? (state?.updates ?? []).map(app => ({...catalog.get(app.id), ...app})) : recommended;
        if (!['Discover', 'Installed', 'Updates', 'Packages'].includes(section)) apps = apps.filter(app => app.category === section);
        return {apps: apps.filter(app => matchesApp(app, query)),
            featured: registryCatalog.filter(app => ['vscode', 'claude-desktop', 'chrome'].includes(app.registry.id)),
            installedCount: userApps.length + (state?.installed.length ?? 0),
            installedIds: [...(state?.installed ?? []).map(app => app.id), ...userApps.map(app => app.id)],
            selectedPackage: selected ? packages.find(item => item.id === (selected.userPackage || (selected.registry ? bindings[selected.registry.id] : ''))) : undefined,
            detailsInstalled: selected ? state?.installed.find(app => app.id === selected.id) : undefined};
    }
    throw new Error('Unknown app view projection.');
}
