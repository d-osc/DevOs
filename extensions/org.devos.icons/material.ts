import GLib from 'gi://GLib';
import {ROOT} from '../../src/config.js';

interface Mappings {names: Record<string, string>; extensions: Record<string, string>; folders: Record<string, string>;}
let mappings: Mappings | undefined;
let enabled = true;
export function setMaterialIcons(value: boolean) { const previous = enabled; enabled = value; return previous; }
export function materialIcon(path = '', directory = false): string | undefined {
    if (!enabled) return;
    if (!mappings) {
        try { mappings = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.icons/material/mapping.json`)[1])) as Mappings; }
        catch (error) { printerr(`Material icons unavailable: ${String(error)}`); enabled = false; return; }
    }
    const name = path.split('/').filter(Boolean).at(-1)?.toLowerCase() ?? '';
    const lookup = (map: Record<string, string>, key: string) => Object.hasOwn(map, key) ? map[key] : undefined;
    if (directory) return lookup(mappings.folders, name) ?? 'dev-os-material-folder';
    const exact = lookup(mappings.names, name);
    if (exact) return exact;
    // Prefer compound extensions (e.g. d.ts) over the final suffix.
    const parts = name.split('.');
    for (let index = 1; index < parts.length; index++) {
        const icon = lookup(mappings.extensions, parts.slice(index).join('.'));
        if (icon) return icon;
    }
    return 'dev-os-material-file';
}
