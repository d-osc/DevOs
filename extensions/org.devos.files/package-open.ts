import {installableFile} from '../org.devos.appstore/package-file.js';

/**
 * Files <-> install page routing for .dpk, .deb, .rpm and .tar.gz.
 * Double-click, Enter, the Open button and Quick Open all reach `openPackageFile`; the context menu uses `installAction`.
 * A .tar.gz that does not look installable (no package.json / .desktop) is left to the normal open behaviour.
 */
export function openPackageFile(path: string, openPackage?: (path: string) => boolean): boolean {
    if (!openPackage || !installableFile(path)) return false;
    return openPackage(path);
}
/** The context-menu action for a file entry, or undefined when the Install item must not appear (folders, other types, plain archives). */
export function installAction(entry: {path: string; directory: boolean; modified?: number} | undefined, install?: (path: string) => void): (() => void) | undefined {
    if (!entry || !install || !installableFile(entry.path, entry.directory, entry.modified ?? 0)) return undefined;
    return () => install(entry.path);
}
