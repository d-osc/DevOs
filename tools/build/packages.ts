import {readdirSync, readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const libraryNames = readdirSync(resolve(root, 'packages')).filter(name =>
    existsSync(resolve(root, 'packages', name, 'package.json')));

export function libraryMetadata(name: string): {exports: Record<string, unknown>; dependencies: Record<string, string>} {
    return JSON.parse(readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8'));
}

export function runtimeName(name: string, subpath?: string): string {
    if (subpath) return `${name}-${subpath.replaceAll('/', '-')}`;
    return name === 'supervisor' ? 'supervisor-lib' : name;
}

export function libraryEntries(): Record<string, string> {
    return Object.fromEntries(libraryNames.flatMap(name => Object.keys(libraryMetadata(name).exports).map(key => {
        const subpath = key === '.' ? undefined : key.slice(2);
        const source = `packages/${name}/${subpath ?? 'index'}`;
        return [runtimeName(name, subpath), source + (existsSync(resolve(root, source + '.tsx')) ? '.tsx' : '.ts')];
    })));
}

export function reservedRuntimeEntry(entry: string): boolean {
    const stem = entry.replace(/\.js$/, '');
    return stem === 'react-gtk' || libraryNames.some(name => stem === name || stem.startsWith(`${name}-`));
}
