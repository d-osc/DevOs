import data from './registry-data.js';
import type {App} from './backend.js';

export interface RegistryDownload {url: string; format: 'deb' | 'rpm' | 'dpk' | 'dpkx' | 'tar.gz'; arch: string;}
export interface RegistryDetails {id: string; publisher: string; license: string; aliases: string[]; tags: string[]; readme: string; compatibility: string; note: string; download?: RegistryDownload; iconFallback: {text: string; background: string}; iconBase64?: string;}
export interface RegistryApp extends App {registry: RegistryDetails;}
const categories: Record<string, string> = {'developer-tools': 'Developer Tools', 'web-browsers': 'Internet', productivity: 'Productivity', creative: 'Creative', media: 'Media'};
const brandIcons: Record<string, string> = {chatgpt: 'dev-os-store-chatgpt', chrome: 'dev-os-material-chrome', 'claude-desktop': 'dev-os-material-claude', firefox: 'dev-os-store-firefox', vscode: 'dev-os-material-vscode'};
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid registry object');
    return value as Record<string, unknown>;
}
function text(value: unknown): string {return typeof value === 'string' ? value : '';}
function strings(value: unknown): string[] {return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];}
export function safeWebsite(value: unknown): string | undefined {
    const address = text(value);
    return /^https:\/\/[^\s/@?#\\]+(?:\/[^\s\\]*)?$/.test(address) ? address : undefined;
}
/** Metadata only. No package identity, native binding, or install permission is inferred. */
export function registryApps(input: unknown = data): RegistryApp[] {
    const source = record(input);
    if (source.schema_version !== 2 || !Array.isArray(source.apps)) throw new Error('Unsupported app registry');
    const seen = new Set<string>();
    return source.apps.map(entry => {
        const row = record(entry), app = record(row.manifest), id = text(app.id);
        if (app.schema_version !== 2 || !/^[a-z0-9][a-z0-9-]*$/.test(id) || seen.has(id) || !text(app.name)) throw new Error('Invalid registry application');
        seen.add(id);
        const compatibility = record(app.compatibility), publisher = record(app.publisher), links = record(app.links);
        const fallback = app.icon_fallback ? record(app.icon_fallback) : {};
        const iconFallback = {text: text(fallback.text).trim().slice(0, 4) || text(app.name).trim().slice(0, 2).toUpperCase(), background: /^#[0-9a-f]{6}$/i.test(text(fallback.background)) ? text(fallback.background) : '#3157ce'};
        const iconBase64 = typeof row.iconBase64 === 'string' && row.iconBase64.length <= 349528 && /^[A-Za-z0-9+/]+={0,2}$/.test(row.iconBase64) ? row.iconBase64 : undefined;
        const upstream = (Array.isArray(app.downloads) ? app.downloads : []).map(record).find(item => item.platform === 'linux' && item.arch === 'arm64' && ['deb', 'rpm', 'dpk', 'dpkx', 'tar.gz'].includes(text(item.format)) && safeWebsite(item.file_url));
        const download = upstream ? {url: safeWebsite(upstream.file_url)!, format: upstream.format as RegistryDownload['format'], arch: 'arm64'} : undefined;
        return {id: `registry:${id}`, name: text(app.name), description: text(app.summary), category: categories[strings(app.categories)[0]] || 'Other', website: safeWebsite(links.homepage), icon: brandIcons[id],
            registry: {id, publisher: text(publisher.name), license: text(app.license), aliases: strings(app.aliases), tags: strings(app.tags), readme: text(row.readme), compatibility: text(compatibility.status), note: text(compatibility.note), download, iconFallback, iconBase64}};
    });
}
export function matchesApp(app: App & {registry?: RegistryDetails}, query: string): boolean {
    return [app.name, app.id, app.description, app.category, app.registry?.publisher, ...(app.registry?.aliases ?? []), ...(app.registry?.tags ?? [])].join(' ').toLowerCase().includes(query.trim().toLowerCase());
}
