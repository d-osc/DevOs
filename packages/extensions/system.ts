import {
    readJson, Gio, type UIExtension
} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {validateManifest} from './schema.js';
import type {ExtensionManifest} from './types.js';

export function systemManifests(root = ROOT): ExtensionManifest[] {
    const directory = Gio.File.new_for_path(`${root}/extensions`);
    const files = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    const manifests: ExtensionManifest[] = [];
    try {
        for (let item = files.next_file(null); item; item = files.next_file(null)) {
            if (item.get_file_type() !== Gio.FileType.DIRECTORY) continue;
            const file = directory.get_child(item.get_name()).get_child('extension.json');
            if (!file.query_exists(null)) continue;
            const raw = readJson<Record<string, unknown>>(file.get_path()!);
            if (raw?.kind !== 'ui') continue;
            const manifest = validateManifest(raw);
            if (manifest.id !== item.get_name()) throw new Error('UI package folder must match manifest ID');
            if (manifest.system) manifests.push(manifest);
        }
    } finally { files.close(null); }
    if (!manifests.length) throw new Error('No system UI manifests found');
    return manifests.sort((a, b) => a.order! - b.order! || a.id.localeCompare(b.id));
}

export async function loadSystemExtensions(root = ROOT): Promise<UIExtension[]> {
    // Start imports together, but preserve manifest order for activation.
    return Promise.all(systemManifests(root).map(async manifest => {
        const file = Gio.File.new_for_path(`${root}/dist/${manifest.entry}`);
        const definition = (await import(file.get_uri())).default as UIExtension;
        if (!definition || definition.id !== manifest.id || typeof definition.activate !== 'function')
            throw new Error(`UI entry does not match manifest ${manifest.id}`);
        return definition;
    }));
}
