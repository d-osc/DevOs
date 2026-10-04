import {validateManifest} from './schema.js';
import {parseAsset, repository, version, type Release} from '../updates/protocol.js';
import type {ExtensionManifest} from './types.js';

export type ExtensionRelease = Omit<Release, 'platform'> & {manifest: ExtensionManifest};
export function repoInput(input: string): string {
    const text = input.trim().replace(/\/$/, '').replace(/\.git$/, '');
    return repository(text.replace(/^https:\/\/github\.com\//, ''));
}
export function manifestForRelease(raw: unknown, releaseVersion: string, protectedIds: string[]): ExtensionManifest {
    const manifest = validateManifest(raw);
    if (manifest.system || protectedIds.includes(manifest.id)) throw new Error('Store packages cannot replace a system extension');
    if (manifest.kind === 'ui' && manifest.entry === 'react-gtk.js') throw new Error('react-gtk.js is reserved for the shared desktop runtime');
    if (version(manifest.version) !== releaseVersion) throw new Error('Extension version must match the stable release tag');
    return manifest;
}
export function extensionAsset(raw: unknown, repo: string) { return parseAsset(raw, repo, 'dev-os-extension.tar.gz', 32 * 1024 * 1024); }
export function manifestAsset(raw: unknown, repo: string) { return parseAsset(raw, repo, 'extension.json', 256 * 1024); }
export function validateExtensionArchive(names: string, details: string, manifest: ExtensionManifest) {
    const paths = names.trimEnd().split('\n'), rows = details.trimEnd().split('\n');
    if (!paths.length || paths.length > 4000 || paths.length !== rows.length) throw new Error('Invalid extension package file list');
    const seen = new Set<string>(); let total = 0;
    for (let index = 0; index < paths.length; index++) {
        const path = paths[index], canonical = path.replace(/\/$/, '');
        if (!/^extension(?:\/[A-Za-z0-9._/-]*)?\/?$/.test(path) || path.length > 512 || path.includes('//') || path.split('/').some(part => part === '.' || part === '..') || seen.has(canonical))
            throw new Error('Unsafe or duplicate path in extension package');
        seen.add(canonical);
        if (!['-', 'd'].includes(rows[index][0])) throw new Error('Extension packages cannot contain links or special files');
        const size = Number(rows[index].trim().split(/\s+/)[2]);
        if (!Number.isSafeInteger(size) || size < 0 || (total += size) > 128 * 1024 * 1024) throw new Error('Extension package expands beyond its size limit');
    }
    for (const required of ['extension/extension.json', ...(manifest.kind === 'ui' ? [`extension/dist/${manifest.entry}`] : [])])
        if (!seen.has(required)) throw new Error(`Extension package is missing ${required}`);
    if (seen.has('extension/store-install.json')) throw new Error('Extension package cannot supply installation history');
}
