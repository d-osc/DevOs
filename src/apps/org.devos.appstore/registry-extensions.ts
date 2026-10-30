import data from './registry-data.js';

export interface RegistryExtension {
    id: string; name: string; description: string; version: string; publisher: string;
    tags: string[]; readme: string; license: string; repository?: string; iconBase64?: string;
}
const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid extension registry object');
    return value as Record<string, unknown>;
};
const text = (value: unknown) => typeof value === 'string' ? value : '';
export function registryExtensions(input: unknown = data): RegistryExtension[] {
    const registry = object(input);
    if (registry.schema_version !== 2 || !Array.isArray(registry.extensions)) throw new Error('Unsupported extension registry');
    const ids = new Set<string>(), repositories = new Set<string>();
    return registry.extensions.map(value => {
        const row = object(value), listing = object(row.listing), manifest = object(row.manifest);
        const id = text(listing.id), delivery = object(listing.delivery), source = object(delivery.source), target = object(listing.target);
        if (listing.schema_version !== 2 || listing.kind !== 'extension' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(id) || id.startsWith('org.devos.') || ids.has(id) || manifest.id !== id || manifest.name !== listing.name || !text(listing.name) || manifest.system === true) throw new Error('Invalid extension registry identity');
        if (delivery.backend !== 'devos-extension-store' || delivery.scope !== 'user' || target.platform !== 'linux' || target.arch !== 'arm64' || target.apiVersion !== 1 || manifest.apiVersion !== 1 || !['settings', 'ui'].includes(text(manifest.kind))) throw new Error('Unsupported extension delivery');
        if (!['draft', 'published'].includes(text(listing.status)) || !['local-example', 'github'].includes(text(source.type)) || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(text(manifest.version))) throw new Error('Invalid extension release metadata');
        if (source.type === 'local-example' && listing.status !== 'draft') throw new Error('Local examples must be unpublished');
        let repository: string | undefined;
        if (source.type === 'github') {
            const candidate = text(source.repository);
            if (candidate.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(candidate) || repositories.has(candidate.toLowerCase())) throw new Error('Invalid extension repository');
            repositories.add(candidate.toLowerCase());
            if (listing.status === 'published') repository = candidate;
        }
        ids.add(id);
        return {id, name: text(listing.name), description: text(listing.summary), version: text(manifest.version), publisher: text(object(listing.publisher).name), license: text(listing.license),
            tags: Array.isArray(listing.tags) ? listing.tags.filter((tag): tag is string => typeof tag === 'string') : [], readme: text(row.readme), repository,
            iconBase64: typeof row.iconBase64 === 'string' && row.iconBase64.length <= 349528 && /^[A-Za-z0-9+/]+={0,2}$/.test(row.iconBase64) ? row.iconBase64 : undefined};
    });
}
export function matchesExtension(entry: RegistryExtension, query: string): boolean {
    return [entry.id, entry.name, entry.description, entry.publisher, ...entry.tags].join(' ').toLowerCase().includes(query.trim().toLowerCase());
}
export function matchingExtensionRelease(expectedId: string, actualId: string | undefined): boolean { return actualId === expectedId; }
