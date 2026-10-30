import {readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {resolve, relative, isAbsolute, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {validateManifest} from '../../packages/extensions/schema.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = realpathSync(resolve(process.argv[2] || resolve(root, '../DevOsAppStore')));
function read(path) {
    const file = realpathSync(resolve(source, path)), child = relative(source, file);
    if (child.startsWith('..') || isAbsolute(child)) throw new Error('Registry path escapes its root');
    const text = readFileSync(file, 'utf8');
    if (Buffer.byteLength(text) > 262144) throw new Error('Registry document is too large');
    return text;
}
const apps = readdirSync(resolve(source, 'apps'), {withFileTypes: true}).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).map(item => {
    const manifest = JSON.parse(read(`apps/${item.name}/app.json`));
    if (manifest.schema_version !== 2 || manifest.id !== item.name || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) throw new Error('Invalid registry identity');
    let iconBase64;
    if (manifest.icon) {
        const appRoot = realpathSync(resolve(source, 'apps', item.name));
        const file = realpathSync(resolve(appRoot, manifest.icon)), child = relative(appRoot, file);
        if (child.startsWith('..') || isAbsolute(child) || !['.svg', '.png', '.xpm'].includes(extname(file).toLowerCase())) throw new Error('Invalid registry icon path or format');
        const bytes = readFileSync(file);
        if (!bytes.length || bytes.length > 262144) throw new Error('Registry icon must be at most 256 KiB');
        iconBase64 = bytes.toString('base64');
    }
    return {manifest, readme: read(`apps/${item.name}/${manifest.readme}`), ...(iconBase64 ? {iconBase64} : {})};
});
const repositories = new Set();
const extensions = readdirSync(resolve(source, 'extensions'), {withFileTypes: true}).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).map(item => {
    const directory = `extensions/${item.name}`, listing = JSON.parse(read(`${directory}/listing.json`));
    const child = file => {
        if (typeof file !== 'string' || !file || file.includes('\\') || file.includes(':') || file.startsWith('/') || file.split('/').includes('..')) throw new Error('Invalid extension listing path');
        const folder = realpathSync(resolve(source, directory)), full = realpathSync(resolve(folder, file)), within = relative(folder, full);
        if (within.startsWith('..') || isAbsolute(within)) throw new Error('Extension asset escapes its listing');
        return full;
    };
    if (listing.schema_version !== 2 || listing.kind !== 'extension' || listing.id !== item.name || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(listing.id) || listing.id.startsWith('org.devos.')) throw new Error('Invalid registry extension identity');
    if (!['draft', 'published'].includes(listing.status) || listing.target?.platform !== 'linux' || listing.target?.arch !== 'arm64' || listing.target?.apiVersion !== 1) throw new Error('Unsupported registry extension target');
    const delivery = listing.delivery, origin = delivery?.source;
    if (delivery?.backend !== 'devos-extension-store' || delivery.scope !== 'user' || !['local-example', 'github'].includes(origin?.type)) throw new Error('Unsupported extension delivery');
    if (origin.type === 'github') {
        if (typeof origin.repository !== 'string' || origin.repository.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(origin.repository) || repositories.has(origin.repository.toLowerCase())) throw new Error('Invalid or duplicate extension repository');
        repositories.add(origin.repository.toLowerCase());
    } else if (listing.status !== 'draft') throw new Error('An unpublished example cannot advertise a release');
    const manifestFile = child(listing.manifest);
    const manifest = validateManifest(JSON.parse(read(relative(source, manifestFile))));
    if (manifest.id !== listing.id || manifest.name !== listing.name || manifest.system || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) throw new Error('Extension listing does not match runtime metadata');
    let iconBase64;
    if (listing.icon) {
        const file = child(listing.icon), bytes = readFileSync(file);
        if (!['.svg', '.png', '.xpm'].includes(extname(file).toLowerCase()) || !bytes.length || bytes.length > 262144) throw new Error('Invalid extension registry icon');
        iconBase64 = bytes.toString('base64');
    }
    return {listing, manifest, readme: read(relative(source, child(listing.readme))), ...(iconBase64 ? {iconBase64} : {})};
});
let commit = null;
try {commit = execFileSync('git', ['-C', source, 'rev-parse', '--verify', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();} catch { /* Uncommitted authoring registries have no source commit. */ }
const dirty = !!execFileSync('git', ['-C', source, 'status', '--porcelain'], {encoding: 'utf8'}).trim();
// This is a bundled, read-only authoring preview, never an installation authority.
const data = {schema_version: 2, source_commit: commit, working_tree_dirty: dirty, apps, extensions};
writeFileSync(resolve(root, 'src/apps/org.devos.appstore/registry-data.ts'), '// Generated by node tools/store/import-registry.mjs; do not edit.\nexport default ' + JSON.stringify(data, null, 2) + ';\n');
console.log(`Imported ${apps.length} apps and ${extensions.length} extensions (${commit}${dirty ? ', working tree modified' : ''}).`);
