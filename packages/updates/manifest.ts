// Pure data side of the update package format (no GLib, no Gio): usable from the shell, from gjs tools and from node.
// See docs/updates.md for the format, the trust model and what is not protected.
import type {UpdatePlatform} from './protocol.js';

export const MANIFEST_FORMAT = 1;
/** Post-install steps are a closed list: a package can request a restart but can never name a command to run. */
export const POST_INSTALL_ACTIONS = ['restart-shell'] as const;
export type PostInstallAction = typeof POST_INSTALL_ACTIONS[number];
export interface ManifestFile {path: string; sha256: string; size: number; mode: '644' | '755'}
export interface Manifest {
    format: 1; version: string; platform: UpdatePlatform;
    /** Oldest installed version that may take this package (as a full package or as the base of a patch). */
    minCompatible: string;
    postInstall: PostInstallAction[];
    /** Rollback is always the previous installed release; releases are never modified in place. */
    rollback: {strategy: 'keep-previous'};
    files: ManifestFile[];
}
export interface PatchMeta {
    format: 1; kind: 'patch'; from: string; to: string; platform: UpdatePlatform;
    baseManifestSha256: string; targetManifestSha256: string;
    add: ManifestFile[]; replace: ManifestFile[]; remove: string[];
}
export interface ReleaseExtras {
    sums: {url: string; size: number} | null;
    signature: {url: string; size: number} | null;
    patch: {from: string; url: string; size: number; sha256: string; name: string} | null;
    /** Kernel/firmware/system bundle (docs/updates.md, "System updates") and its small description file. */
    system: {name: string; url: string; size: number; sha256: string; metaUrl: string; metaSize: number; metaSha256: string} | null;
}
const SHA = /^[a-f0-9]{64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export function safePath(path: unknown): string {
    if (typeof path !== 'string' || path.length > 512 || !PATH.test(path) || path.split('/').some(part => part === '.' || part === '..'))
        throw new Error('Unsafe path in update manifest');
    return path;
}
function semver(value: unknown, what: string): string {
    if (typeof value !== 'string' || !SEMVER.test(value)) throw new Error(`Invalid ${what} in update manifest`);
    return value;
}
function platformOf(value: unknown): UpdatePlatform {
    if (value !== 'linux-x64' && value !== 'linux-arm64') throw new Error('Invalid platform in update manifest');
    return value;
}
function file(raw: unknown): ManifestFile {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid file entry in update manifest');
    const item = raw as Record<string, unknown>;
    if (typeof item.sha256 !== 'string' || !SHA.test(item.sha256)) throw new Error('Invalid file checksum in update manifest');
    if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > 512 * 1024 * 1024)
        throw new Error('Invalid file size in update manifest');
    if (item.mode !== '644' && item.mode !== '755') throw new Error('Invalid file mode in update manifest');
    return {path: safePath(item.path), sha256: item.sha256, size: item.size, mode: item.mode};
}
function files(raw: unknown): ManifestFile[] {
    if (!Array.isArray(raw) || raw.length > 40000) throw new Error('Invalid file list in update manifest');
    const result = raw.map(file), seen = new Set<string>();
    for (const item of result) {
        if (seen.has(item.path)) throw new Error('Duplicate file in update manifest');
        seen.add(item.path);
    }
    // A file may not also be a directory of another entry: that cannot be unpacked.
    for (const path of seen) for (let at = path.indexOf('/'); at > 0; at = path.indexOf('/', at + 1))
        if (seen.has(path.slice(0, at))) throw new Error('A file and a directory share a path in the update manifest');
    return result;
}
export function buildManifest(input: {version: string; platform: UpdatePlatform; minCompatible?: string;
    postInstall?: PostInstallAction[]; files: ManifestFile[]}): Manifest {
    const manifest: Manifest = {format: MANIFEST_FORMAT, version: semver(input.version, 'version'), platform: platformOf(input.platform),
        minCompatible: semver(input.minCompatible ?? '0.0.0', 'minimum compatible version'),
        postInstall: input.postInstall ?? ['restart-shell'], rollback: {strategy: 'keep-previous'},
        files: files([...input.files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0))};
    return parseManifest(manifest);
}
export function parseManifest(raw: unknown, expected?: {version?: string; platform?: UpdatePlatform}): Manifest {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid update manifest');
    const item = raw as Record<string, unknown>;
    if (item.format !== MANIFEST_FORMAT) throw new Error('Unsupported update manifest format');
    const postInstall = Array.isArray(item.postInstall) ? item.postInstall : null;
    if (!postInstall || postInstall.length > POST_INSTALL_ACTIONS.length || postInstall.some(action => !(POST_INSTALL_ACTIONS as readonly unknown[]).includes(action)))
        throw new Error('Update manifest requests an unknown post-install action');
    const rollback = item.rollback as Record<string, unknown> | undefined;
    if (!rollback || rollback.strategy !== 'keep-previous') throw new Error('Unsupported rollback strategy in update manifest');
    const manifest: Manifest = {format: 1, version: semver(item.version, 'version'), platform: platformOf(item.platform),
        minCompatible: semver(item.minCompatible, 'minimum compatible version'), postInstall: [...new Set(postInstall)] as PostInstallAction[],
        rollback: {strategy: 'keep-previous'}, files: files(item.files)};
    if (expected?.version !== undefined && manifest.version !== expected.version) throw new Error('Update manifest version does not match the release');
    if (expected?.platform !== undefined && manifest.platform !== expected.platform) throw new Error('Update manifest platform does not match the release');
    return manifest;
}
export function serialize(value: unknown): string { return JSON.stringify(value, null, 2) + '\n'; }
/** Text for `sha256sum --check`, relative to the release root. */
export function checksumList(manifest: Manifest | Pick<Manifest, 'files'>): string {
    return manifest.files.map(item => `${item.sha256}  ${item.path}\n`).join('');
}
export function parseSums(text: string): Map<string, string> {
    const result = new Map<string, string>();
    if (text.length > 64 * 1024) throw new Error('SHA256SUMS is too large');
    for (const line of text.split('\n')) {
        if (!line) continue;
        const match = /^([a-f0-9]{64}) [ *]([A-Za-z0-9._-]+)$/.exec(line);
        if (!match) throw new Error('SHA256SUMS has an invalid line');
        if (result.has(match[2])) throw new Error('SHA256SUMS lists a file twice');
        result.set(match[2], match[1]);
    }
    return result;
}
export function patchAssetName(from: string, to: string, platform: UpdatePlatform): string {
    return `dev-os-patch-${semver(from, 'version')}-to-${semver(to, 'version')}-${platformOf(platform)}.tar.gz`;
}
export interface Diff {add: ManifestFile[]; replace: ManifestFile[]; remove: string[]; unchanged: number}
export function diffManifests(from: Manifest, to: Manifest): Diff {
    const before = new Map(from.files.map(item => [item.path, item])), after = new Set(to.files.map(item => item.path));
    const diff: Diff = {add: [], replace: [], remove: [], unchanged: 0};
    for (const item of to.files) {
        const old = before.get(item.path);
        if (!old) diff.add.push(item);
        else if (old.sha256 !== item.sha256 || old.mode !== item.mode) diff.replace.push(item);
        else diff.unchanged++;
    }
    for (const item of from.files) if (!after.has(item.path)) diff.remove.push(item.path);
    return diff;
}
export function parsePatch(raw: unknown): PatchMeta {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid update patch');
    const item = raw as Record<string, unknown>;
    if (item.format !== MANIFEST_FORMAT || item.kind !== 'patch') throw new Error('Unsupported update patch format');
    for (const key of ['baseManifestSha256', 'targetManifestSha256'])
        if (typeof item[key] !== 'string' || !SHA.test(item[key] as string)) throw new Error('Invalid manifest checksum in update patch');
    if (!Array.isArray(item.remove) || item.remove.length > 40000) throw new Error('Invalid removal list in update patch');
    const remove = item.remove.map(safePath), changed = [...files(item.add), ...files(item.replace)];
    const paths = new Set(changed.map(entry => entry.path));
    if (paths.size !== changed.length || remove.some(path => paths.has(path))) throw new Error('Update patch lists a path twice');
    return {format: 1, kind: 'patch', from: semver(item.from, 'from version'), to: semver(item.to, 'to version'), platform: platformOf(item.platform),
        baseManifestSha256: item.baseManifestSha256 as string, targetManifestSha256: item.targetManifestSha256 as string,
        add: files(item.add), replace: files(item.replace), remove};
}
/** Assets next to the update package on the same GitHub release; every URL must belong to that release. */
export function releaseExtras(raw: unknown, repo: string, platform: UpdatePlatform, installed: string | null): ReleaseExtras {
    const release = (raw ?? {}) as Record<string, unknown>, tag = String(release.tag_name), to = tag.replace(/^v/, '');
    const assets = Array.isArray(release.assets) ? release.assets as Record<string, unknown>[] : [];
    const find = (name: string, limit: number) => {
        const asset = assets.find(entry => entry && entry.name === name && entry.state === 'uploaded');
        if (!asset) return null;
        const url = `https://github.com/${repo}/releases/download/${tag}/${name}`;
        if (asset.browser_download_url !== url || typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > limit) return null;
        const digest = typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest) ? asset.digest.slice(7).toLowerCase() : '';
        return {url, size: asset.size as number, sha256: digest, name};
    };
    const sums = find('SHA256SUMS', 64 * 1024), signature = find('SHA256SUMS.sig', 1024);
    let patch: ReleaseExtras['patch'] = null;
    if (installed && SEMVER.test(installed) && SEMVER.test(to)) {
        const found = find(patchAssetName(installed, to, platform), 128 * 1024 * 1024);
        if (found) patch = {from: installed, url: found.url, size: found.size, sha256: found.sha256, name: found.name};
    }
    const bundle = find(`dev-os-system-${platform}.tar.gz`, 2 * 1024 * 1024 * 1024 - 1), meta = find(`dev-os-system-${platform}.json`, 8 * 1024 * 1024);
    const system = bundle && meta ? {name: bundle.name, url: bundle.url, size: bundle.size, sha256: bundle.sha256, metaUrl: meta.url, metaSize: meta.size, metaSha256: meta.sha256} : null;
    return {sums: sums && {url: sums.url, size: sums.size}, signature: signature && {url: signature.url, size: signature.size}, patch, system};
}
export function validatePatchArchive(names: string, details: string): void {
    const paths = names.trimEnd().split('\n'), rows = details.trimEnd().split('\n');
    if (paths.length > 40000 || paths.length !== rows.length) throw new Error('Invalid patch file list');
    let total = 0;
    for (let index = 0; index < paths.length; index++) {
        const path = paths[index], row = rows[index];
        if (!/^dev-os-patch(?:\/[A-Za-z0-9._/-]*)?\/?$/.test(path) || path.length > 600 || path.split('/').some(part => part === '..' || part === '.'))
            throw new Error('Unsafe path in update patch');
        if (!['-', 'd'].includes(row[0])) throw new Error('Update patches cannot contain links or special files');
        const size = Number(row.trim().split(/\s+/)[2]);
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid patch member size');
        total += size;
        if (total > 1024 * 1024 * 1024) throw new Error('Update patch expands beyond 1 GiB');
    }
    for (const required of ['dev-os-patch/patch.json', 'dev-os-patch/manifest.json'])
        if (!paths.includes(required)) throw new Error(`Update patch is missing ${required}`);
}
