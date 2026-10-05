import {libraryEntries, libraryNames, runtimeName, reservedRuntimeEntry} from './packages.ts';
import {build} from 'esbuild';
import {readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, cpSync, mkdtempSync, rmSync, existsSync} from 'node:fs';
import {resolve, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateManifest} from '../../packages/extensions/schema.ts';
import {version} from '../../packages/updates/protocol.ts';

const toolkit = fileURLToPath(new URL('../../', import.meta.url));
if (!process.argv[2]) throw new Error('Usage: node tools/build/extension-release.ts <extension-directory> [output-directory]');
const source = resolve(process.argv[2]), output = resolve(process.argv[3] ?? join(toolkit, 'build/extension-release'));
const manifest = validateManifest(JSON.parse(readFileSync(join(source, 'extension.json'), 'utf8')));
if (manifest.system) throw new Error('Store packages cannot declare system UI');
if (manifest.kind === 'ui' && reservedRuntimeEntry(manifest.entry!)) throw new Error('Shared package entry names are reserved for the shared desktop runtime');
for (const directory of readdirSync(join(toolkit, 'extensions'))) {
    const file = join(toolkit, 'extensions', directory, 'extension.json');
    if (existsSync(file)) { const base = JSON.parse(readFileSync(file, 'utf8')); if (base.system && base.id === manifest.id) throw new Error('Store packages cannot replace base extensions'); }
}
const releaseVersion = version(process.env.DEV_OS_RELEASE_VERSION ?? manifest.version);
if (manifest.version !== releaseVersion) throw new Error('Manifest version must match DEV_OS_RELEASE_VERSION / the GitHub tag');
function validatePaths(path: string) {
    if (!/^[A-Za-z0-9._-]+$/.test(basename(path)) || lstatSync(path).isSymbolicLink()) throw new Error(`Unsafe package asset: ${path}`);
    if (lstatSync(path).isDirectory()) for (const entry of readdirSync(path)) validatePaths(join(path, entry));
    else if (!lstatSync(path).isFile()) throw new Error(`Unsupported package asset: ${path}`);
}
const temporary = mkdtempSync(join(tmpdir(), 'dev-os-extension-release-'));
try {
    const destination = join(temporary, 'extension'); mkdirSync(destination);
    writeFileSync(join(destination, 'extension.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const asset of ['assets', 'icons', 'style.css']) if (existsSync(join(source, asset))) {
        validatePaths(join(source, asset)); cpSync(join(source, asset), join(destination, asset), {recursive: true});
    }
    if (manifest.kind === 'ui') {
        const entry = ['extension.tsx', 'extension.ts'].map(name => join(source, name)).find(existsSync);
        if (!entry) throw new Error('UI packages need extension.ts or extension.tsx');
        mkdirSync(join(destination, 'dist'));
        const shared = Object.keys(libraryEntries());
        for (const name of shared) {
            const runtimePath = join(toolkit, 'dist', name + '.js');
            if (!existsSync(runtimePath)) throw new Error('Build the Dev OS toolkit first: npm run build');
            const inspection = await build({entryPoints: [runtimePath], bundle: false, write: false, metafile: true, logLevel: 'silent'});
            const names = Object.values(inspection.metafile!.outputs)[0].exports;
            writeFileSync(join(destination, 'dist', name + '.js'), `import Gio from 'gi://Gio';\nimport GLib from 'gi://GLib';\nconst root = GLib.getenv('DEV_OS_ROOT');\nif (!root) throw new Error('Start this extension inside Dev OS');\nconst runtime = await import(Gio.File.new_for_path(root + '/dist/${name}.js').get_uri());\nexport const {${names.join(',')}} = runtime;\n${name === 'core' ? 'export default runtime.React;\n' : ''}`);
        }
        await build({entryPoints: [entry], outfile: join(destination, 'dist', manifest.entry!), bundle: true,
            format: 'esm', platform: 'neutral', target: 'firefox115', jsx: 'transform',
            external: ['gi://*', 'cairo', 'system'], plugins: [{name: 'native-react', setup(builder) {
                builder.onResolve({filter: /^(?:@dev-os\/[\w-]+(?:\/[\w/-]+)?|react)$/}, args => {
                    if (args.path === 'react') return {path: './core.js', external: true};
                    const [, name, subpath] = args.path.match(/^@dev-os\/([^/]+)(?:\/(.+))?$/)!;
                    if (!libraryNames.includes(name)) return;
                    return {path: './' + runtimeName(name, subpath) + '.js', external: true};
                });
            }}], logLevel: 'info'});
    }
    mkdirSync(output, {recursive: true});
    const archive = join(output, 'dev-os-extension.tar.gz');
    const result = spawnSync('tar', ['-czf', archive, '-C', temporary, 'extension'], {stdio: 'inherit'});
    if (result.status !== 0) throw new Error('Could not package the extension; install tar first');
    cpSync(join(destination, 'extension.json'), join(output, 'extension.json'));
    writeFileSync(join(output, 'SHA256SUMS'), ['dev-os-extension.tar.gz', 'extension.json'].map(name => `${createHash('sha256').update(readFileSync(join(output, name))).digest('hex')}  ${name}`).join('\n') + '\n');
    console.log(`Extension ${manifest.id} ${releaseVersion}: ${output}`);
} finally { rmSync(temporary, {recursive: true, force: true}); }
