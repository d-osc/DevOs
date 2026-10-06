import {version} from './protocol.js';

export const SWAYLOCK_RELEASES = 'https://github.com/swaywm/swaylock/releases';
export const SWAYLOCK_PINNED_VERSION = '1.7.2';
export interface DependencyUpdate {
    installed: string | null;
    latest: string | null;
    available: boolean;
    error: string;
}

export function parseSwaylockRelease(raw: unknown): string {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid swaylock release response');
    const release = raw as Record<string, unknown>;
    if (release.draft === true || release.prerelease === true) throw new Error('swaylock release is not stable');
    const latest = version(release.tag_name);
    if (release.html_url !== `${SWAYLOCK_RELEASES}/tag/${String(release.tag_name)}`)
        throw new Error('Invalid swaylock release source');
    return latest;
}

export function parseSwaylockVersion(output: string): string {
    const match = /^swaylock version v?(\d+\.\d+\.\d+)(?:\s|$)/m.exec(output);
    if (!match) throw new Error('Cannot determine installed swaylock version');
    return version(match[1]);
}
