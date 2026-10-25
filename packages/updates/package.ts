// Operations on update packages that need subprocesses (tar, sha256sum, openssl, cp): everything runs through the
// async `run` helper so the shell never blocks. Shared by the updater, by tools/release/make-patch.ts and by the tests.
import {Gio, GLib, readJson, removeTree} from '@dev-os/core/base';
import {run} from './installed.js';
import {validateArchive} from './protocol.js';
import {
    parseManifest, parsePatch, diffManifests, checksumList, serialize, validatePatchArchive,
    type Manifest, type PatchMeta
} from './manifest.js';

const ARGUMENTS = 'sh';
function write(path: string, text: string) { GLib.file_set_contents(path, text); }
export async function sha256(path: string, cancel: Gio.Cancellable): Promise<string> {
    return (await run(['sha256sum', '--', path], cancel, 300)).split(/\s+/)[0];
}
/** Free bytes for unprivileged writes in `directory`. */
export async function freeBytes(directory: string, cancel: Gio.Cancellable): Promise<number> {
    const rows = (await run(['df', '-Pk', '--', directory], cancel, 20)).split('\n');
    const available = Number(rows[rows.length - 1].trim().split(/\s+/)[3]);
    if (!Number.isFinite(available)) throw new Error('Cannot read free disk space');
    return available * 1024;
}
export async function treeBytes(directory: string, cancel: Gio.Cancellable): Promise<number> {
    return Number((await run(['du', '-sk', '--', directory], cancel, 120)).split(/\s+/)[0]) * 1024;
}
/** The tree under `directory` must be exactly `manifest` (plus manifest.json): contents, file set and executable bits. */
export async function verifyTree(directory: string, manifest: Manifest, cancel: Gio.Cancellable): Promise<void> {
    const list = GLib.build_filenamev([directory, '..', `.verify-${GLib.uuid_string_random()}.sums`]);
    write(list, checksumList(manifest));
    try {
        const listing = await run(['find', directory, '-mindepth', '1', '-printf', '%y\t%m\t%P\n'], cancel, 120);
        const expected = new Map(manifest.files.map(item => [item.path, item]));
        const seen = new Set<string>();
        for (const row of listing.split('\n')) {
            const [type, mode, path] = row.split('\t');
            if (path === 'manifest.json' && type === 'f') continue;
            if (type === 'd') continue; // Directories only exist as parents of listed files; empty ones are harmless.
            const item = expected.get(path);
            if (type !== 'f' || !item) throw new Error(`Unexpected file ${path} in the update`);
            if ((item.mode === '755') !== ((parseInt(mode, 8) & 0o100) !== 0)) throw new Error(`Wrong permissions on ${path}`);
            seen.add(path);
        }
        if (seen.size !== expected.size) throw new Error('The update is missing files listed in its manifest');
        await run([ARGUMENTS, '-c', 'cd "$1" && sha256sum --check --quiet --strict -- "$2"', ARGUMENTS, directory, list], cancel, 600)
            .catch(() => { throw new Error('A file in the update does not match its manifest checksum'); });
    } finally { try { Gio.File.new_for_path(list).delete(null); } catch { /* Already gone. */ } }
}
export async function readManifest(directory: string): Promise<Manifest | null> {
    const path = `${directory}/manifest.json`;
    if (!GLib.file_test(path, GLib.FileTest.IS_REGULAR)) return null;
    return parseManifest(readJson(path));
}
export type Trust = 'verified' | 'unsigned';
/** Public keys that ship with the running version. Without any, releases are only checked by hash. */
export function trustedKeys(directory: string): string[] {
    if (!GLib.file_test(directory, GLib.FileTest.IS_DIR)) return [];
    const keys: string[] = [], children = Gio.File.new_for_path(directory).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    try { for (let child = children.next_file(null); child; child = children.next_file(null)) if (/^[A-Za-z0-9._-]+\.pub$/.test(child.get_name())) keys.push(`${directory}/${child.get_name()}`); }
    finally { children.close(null); }
    return keys.sort();
}
/**
 * Ed25519 check of SHA256SUMS. With a key installed a missing or invalid signature is fatal; without one the result is
 * 'unsigned' (the release is then only as trustworthy as the HTTPS connection to the pinned repository).
 */
export async function checkSignature(sums: string, signature: string | null, keys: string[], cancel: Gio.Cancellable): Promise<Trust> {
    if (keys.length === 0) return 'unsigned';
    if (!signature) throw new Error('This release is not signed, but this Dev OS only installs signed releases. Nothing was changed.');
    for (const key of keys) {
        try {
            await run(['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', key, '-rawin', '-in', sums, '-sigfile', signature], cancel, 30);
            return 'verified';
        } catch { /* Try the next key. */ }
    }
    throw new Error('The release signature is invalid (or openssl is missing). Nothing was changed.');
}
export async function archiveManifestPath(archive: string, cancel: Gio.Cancellable): Promise<Manifest | null> {
    try { return parseManifest(JSON.parse(await run(['tar', '-xzOf', archive, 'dev-os/manifest.json'], cancel, 60))); }
    catch { return null; }
}
async function tarList(archive: string, cancel: Gio.Cancellable): Promise<[string, string]> {
    return [await run(['tar', '-tzf', archive, '--quoting-style=escape'], cancel), await run(['tar', '-tvzf', archive, '--numeric-owner', '--quoting-style=escape'], cancel)];
}
/** Build `dev-os-patch-*.tar.gz` that turns the package `from` into the package `to` (both full update packages). */
export async function createPatch(fromArchive: string, toArchive: string, output: string, cancel = new Gio.Cancellable()): Promise<PatchMeta> {
    const temporary = GLib.dir_make_tmp('dev-os-patch-XXXXXX');
    try {
        const from = await archiveManifestPath(fromArchive, cancel), to = await archiveManifestPath(toArchive, cancel);
        if (!from || !to) throw new Error('Both packages need a manifest.json. Rebuild them with the current tools/build/release.ts.');
        if (from.platform !== to.platform) throw new Error('Packages are for different platforms');
        for (const archive of [fromArchive, toArchive]) { const [names, details] = await tarList(archive, cancel); validateArchive(names, details); }
        const target = `${temporary}/target`, patchRoot = `${temporary}/dev-os-patch`;
        Gio.File.new_for_path(target).make_directory(null);
        await run(['tar', '-xzf', toArchive, '-C', target, '--strip-components=1', '--no-same-owner'], cancel, 300);
        const diff = diffManifests(from, to);
        const tree = `${patchRoot}/tree`;
        GLib.mkdir_with_parents(tree, 0o755);
        const changed = [...diff.add, ...diff.replace].map(item => item.path);
        if (changed.length > 0) {
            write(`${temporary}/changed.list`, changed.map(path => `${path}\n`).join(''));
            await run(['sh', '-c', 'tar -cf - -C "$1" -T "$3" | tar -xf - -C "$2" --no-same-owner', 'sh', target, tree, `${temporary}/changed.list`], cancel, 300);
        }
        // Hash of the exact manifest.json bytes inside each package (run() trims output, so go through a file).
        const hashOf = async (archive: string) => {
            const copy = `${temporary}/m-${GLib.uuid_string_random()}`;
            await run(['sh', '-c', 'tar -xzOf "$1" dev-os/manifest.json > "$2"', 'sh', archive, copy], cancel);
            return sha256(copy, cancel);
        };
        const meta: PatchMeta = {format: 1, kind: 'patch', from: from.version, to: to.version, platform: to.platform,
            baseManifestSha256: await hashOf(fromArchive), targetManifestSha256: await hashOf(toArchive),
            add: diff.add, replace: diff.replace, remove: diff.remove};
        write(`${patchRoot}/patch.json`, serialize(meta));
        await run(['sh', '-c', 'tar -xzOf "$1" dev-os/manifest.json > "$2"', 'sh', toArchive, `${patchRoot}/manifest.json`], cancel);
        await run(['tar', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', output, '-C', temporary, 'dev-os-patch'], cancel, 300);
        parsePatch(JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${patchRoot}/patch.json`)[1])));
        return meta;
    } finally { removeTree(temporary); }
}
/**
 * Create the full release tree for the patch's target version at `destination` from the installed tree `baseDir`.
 * Nothing in `baseDir` is modified. The result is verified against the target manifest before it is returned.
 */
export async function applyPatch(archive: string, baseDir: string, destination: string, cancel: Gio.Cancellable): Promise<{meta: PatchMeta; manifest: Manifest}> {
    const [names, details] = await tarList(archive, cancel);
    validatePatchArchive(names, details);
    const staging = `${destination}.patch`;
    removeTree(staging);
    Gio.File.new_for_path(staging).make_directory(null);
    try {
        await run(['tar', '-xzf', archive, '-C', staging, '--strip-components=1', '--no-same-owner'], cancel, 300);
        const meta = parsePatch(readJson(`${staging}/patch.json`)), target = parseManifest(readJson(`${staging}/manifest.json`), {version: meta.to, platform: meta.platform});
        const base = await readManifest(baseDir);
        if (!base) throw new Error('The installed version has no manifest, so a patch cannot be applied. Use the full package.');
        if (base.version !== meta.from || base.platform !== meta.platform) throw new Error(`This patch is for Dev OS ${meta.from}; ${base.version} is installed.`);
        if ((await sha256(`${baseDir}/manifest.json`, cancel)) !== meta.baseManifestSha256) throw new Error('The installed files differ from the version this patch was made for.');
        if ((await sha256(`${staging}/manifest.json`, cancel)) !== meta.targetManifestSha256) throw new Error('The patch manifest does not match its own checksum.');
        // The patch must describe exactly the difference between the two manifests, otherwise it could smuggle extra files in.
        const expected = diffManifests(base, target), key = (items: {path: string; sha256: string; mode: string}[]) => items.map(item => `${item.path}:${item.sha256}:${item.mode}`).sort().join('\n');
        if (key(expected.add) !== key(meta.add) || key(expected.replace) !== key(meta.replace) || [...expected.remove].sort().join('\n') !== [...meta.remove].sort().join('\n'))
            throw new Error('The patch does not match its target manifest.');
        await run(['cp', '-a', '--', baseDir, destination], cancel, 600);
        try {
            for (let offset = 0; offset < meta.remove.length; offset += 100)
                await run(['sh', '-c', 'cd "$1" && shift && rm -f -- "$@"', 'sh', destination, ...meta.remove.slice(offset, offset + 100)], cancel);
            // Prune directories that became empty.
            await run(['find', destination, '-mindepth', '1', '-type', 'd', '-empty', '-delete'], cancel);
            if (meta.add.length + meta.replace.length > 0) await run(['cp', '-a', '--', `${staging}/tree/.`, destination], cancel, 300);
            write(`${destination}/manifest.json`, readManifestText(`${staging}/manifest.json`));
            await verifyTree(destination, target, cancel);
        } catch (error) { removeTree(destination); throw error; }
        return {meta, manifest: target};
    } finally { removeTree(staging); }
}
function readManifestText(path: string): string { return new TextDecoder().decode(GLib.file_get_contents(path)[1]); }
