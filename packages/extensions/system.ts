import {
    readJson, Gio, type UIExtension
} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {validateManifest} from './schema.js';
import type {ExtensionManifest} from './types.js';

export function systemManifests(root = ROOT): ExtensionManifest[] {
    const manifests: ExtensionManifest[] = [];
    for (const folder of ['src/apps', 'src/system']) {
        const directory = Gio.File.new_for_path(`${root}/${folder}`);
        const files = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
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
    }
    if (!manifests.length) throw new Error('No system UI manifests found');
    return manifests.sort((a, b) => a.order! - b.order! || a.id.localeCompare(b.id));
}

export async function loadSystemExtensions(root = ROOT, include: (id: string) => boolean = () => true, manifests?: ExtensionManifest[]): Promise<UIExtension[]> {
    // Start imports together, but preserve manifest order for activation.
    return Promise.all((manifests ?? systemManifests(root)).filter(manifest => include(manifest.id)).map(async manifest => {
        if (manifest.native) return {id: manifest.id, activate: () => () => {}} satisfies UIExtension;
        const file = Gio.File.new_for_path(`${root}/dist/${manifest.entry}`);
        const definition = (await import(file.get_uri())).default as UIExtension;
        if (!definition || definition.id !== manifest.id || typeof definition.activate !== 'function')
            throw new Error(`UI entry does not match manifest ${manifest.id}`);
        return definition;
    }));
}
