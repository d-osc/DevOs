import {
    Gio, type UIExtension
} from '@dev-os/core';
import type {ExtensionManager} from './manager.js';

export async function loadUserExtensions(manager: ExtensionManager): Promise<UIExtension[]> {
    const definitions: UIExtension[] = [];
    for (const info of manager.list().filter(info => info.origin === 'user' && info.manifest.kind === 'ui' && info.state.enabled && !info.error)) {
        try {
            const path = manager.packagePath(info.manifest.id);
            const definition = (await import(Gio.File.new_for_path(`${path}/dist/${info.manifest.entry}`).get_uri())).default as UIExtension;
            if (definition?.id !== info.manifest.id || typeof definition.activate !== 'function') throw new Error('UI entry does not match its manifest');
            definitions.push({id: definition.id, activate(context) {
                return definition.activate({...context, packageRoot: path, registerSettingsPage: context.registerSettingsPage ? (id, page) => {
                    if (id !== definition.id) throw new Error('User extensions can only contribute their own Settings page');
                    return context.registerSettingsPage!(id, page);
                } : undefined});
            }});
        } catch (error) { manager.diagnostics.push(`${info.manifest.id}: ${String(error)}`); printerr(`User extension skipped: ${info.manifest.id}: ${String(error)}`); }
    }
    return definitions.sort((a, b) => manager.get(a.id).manifest.order! - manager.get(b.id).manifest.order! || a.id.localeCompare(b.id));
}
