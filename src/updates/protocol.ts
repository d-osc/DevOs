export type UpdatePlatform = 'linux-x64' | 'linux-arm64';
export interface Release {
    version: string; tag: string; notes: string; published: string;
    repository: string; platform: UpdatePlatform; url: string; size: number; sha256: string;
}
export const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
export function version(value: unknown): string {
    if (typeof value !== 'string' || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
        throw new Error('Release version must be stable semver, for example v0.3.0');
    const result = value.replace(/^v/, '');
    if (!result.split('.').every(part => Number.isSafeInteger(Number(part)))) throw new Error('Invalid release version');
    return result;
}
export function newer(candidate: string, installed: string): boolean {
    const left = version(candidate).split('.').map(Number), right = version(installed).split('.').map(Number);
    for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] > right[index];
    return false;
}
export function repository(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value) || value.length > 200)
        throw new Error('Use a GitHub repository in owner/repo format.');
    return value;
}
export function platform(machine: string): UpdatePlatform {
    if (machine === 'x86_64') return 'linux-x64';
    if (machine === 'aarch64') return 'linux-arm64';
    throw new Error(`No Dev OS release package is available for ${machine}`);
}
export function parseRelease(raw: unknown, repo: string, target: UpdatePlatform): Release {
    repository(repo);
    if (!raw || typeof raw !== 'object') throw new Error('Invalid GitHub release response');
    const release = raw as Record<string, unknown>, tag = release.tag_name;
    const name = version(tag);
    if (release.draft === true || release.prerelease === true) throw new Error('This release is not on the stable channel');
    const assets = Array.isArray(release.assets) ? release.assets as Record<string, unknown>[] : [];
    const asset = assets.find(item => item.name === `dev-os-${target}.tar.gz` && item.state === 'uploaded');
    if (!asset) throw new Error(`Release ${name} has no ${target} package`);
    const expected = `https://github.com/${repo}/releases/download/${tag}/${asset.name}`;
    if (asset.browser_download_url !== expected) throw new Error('Package URL does not belong to the selected GitHub release');
    if (typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_PACKAGE_BYTES)
        throw new Error('Invalid or oversized update package');
    if (typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest))
        throw new Error('This release has no SHA-256 digest. Re-upload its package to GitHub Releases.');
    return {version: name, tag: String(tag), repository: repo, platform: target, url: expected, size: asset.size,
        sha256: asset.digest.slice(7).toLowerCase(), notes: typeof release.body === 'string' ? release.body.slice(0, 12000) : '',
        published: typeof release.published_at === 'string' ? release.published_at : ''};
}
export function validateArchive(names: string, details: string): void {
    const paths = names.trimEnd().split('\n'), rows = details.trimEnd().split('\n');
    if (paths.length > 20000 || paths.length !== rows.length) throw new Error('Invalid package file list');
    let total = 0;
    for (let index = 0; index < paths.length; index++) {
        const path = paths[index], row = rows[index];
        if (!/^dev-os(?:\/[A-Za-z0-9._/-]*)?\/?$/.test(path) || path.length > 512 ||
            path.split('/').some(part => part === '..' || part === '.')) throw new Error('Unsafe path in update package');
        if (!['-', 'd'].includes(row[0])) throw new Error('Update packages cannot contain links or special files');
        const size = Number(row.trim().split(/\s+/)[2]);
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid package member size');
        total += size;
        if (total > 1024 * 1024 * 1024) throw new Error('Update package expands beyond 1 GiB');
    }
    for (const required of ['dev-os/release.json', 'dev-os/dist/main.js', 'dev-os/dist/supervisor.js', 'dev-os/dist/react-gtk.js',
        'dev-os/bin/dev-os-session', 'dev-os/bin/dev-os-shell', 'dev-os/bin/dev-os-start', 'dev-os/native/dev-os-window-tracker'])
        if (!paths.includes(required)) throw new Error(`Update package is missing ${required}`);
}
