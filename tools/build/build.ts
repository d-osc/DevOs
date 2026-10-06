import {libraryEntries, libraryNames, runtimeName, reservedRuntimeEntry} from './packages.ts';
import type {BuildOptions} from 'esbuild';
import {build, context} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateManifest} from '../../packages/extensions/schema.ts';
import {version} from '../../packages/updates/protocol.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const development = process.argv.includes('--watch') || process.argv.includes('--development');
const releaseVersion = version(process.env.DEV_OS_RELEASE_VERSION ?? JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version);
const cacheFile = resolve(root, 'build/build-cache.json');
function inputFingerprint(): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify({releaseVersion, development}));
    const sources: string[] = [];
    const scan = (path: string) => {
        for (const entry of readdirSync(resolve(root, path), {withFileTypes: true})) {
            const child = `${path}/${entry.name}`;
            if (entry.isDirectory()) scan(child);
            else if (/\.(?:ts|tsx|json|css)$/.test(entry.name)) sources.push(child);
        }
    };
    for (const path of ['src', 'extensions', 'packages', 'examples', 'tests', 'tools']) scan(path);
    sources.push(...readdirSync(root).filter(name => /^tsconfig.*\.json$/.test(name)),
        'package.json', 'package-lock.json', 'node_modules/.package-lock.json');
    for (const path of sources.sort()) {
        hash.update(path); hash.update('\0');
        hash.update(existsSync(resolve(root, path)) ? readFileSync(resolve(root, path)) : '<missing>');
        hash.update('\0');
    }
    return hash.digest('hex');
}
const fingerprint = inputFingerprint();
if (process.argv.includes('--if-needed') && !process.argv.includes('--watch')) {
    try {
        const cache = JSON.parse(readFileSync(cacheFile, 'utf8')) as {fingerprint: string; outputs: {path: string; size: number; mtimeMs: number}[]};
        if (cache.fingerprint === fingerprint && cache.outputs.length && cache.outputs.every(output => {
            if (!output.path.startsWith('dist/') || output.path.split('/').includes('..')) return false;
            const stat = statSync(resolve(root, output.path));
            return stat.isFile() && stat.size === output.size && stat.mtimeMs === output.mtimeMs;
        })) {
            console.log('Build is current; starting the existing runtime.');
            process.exit(0);
        }
    } catch { /* A missing, damaged or stale cache requires a full checked build. */ }
}
if (process.platform === 'linux') {
    const native = spawnSync('sh', ['tools/setup/bootstrap-window-tracker.sh'], {cwd: root, stdio: 'inherit'});
    if (native.error) throw native.error;
    if (native.status !== 0) throw new Error('Wayland window tracker build failed');
}
function uiEntries(): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const directory of readdirSync(resolve(root, 'extensions'), {withFileTypes: true})) {
        if (!directory.isDirectory()) continue;
        const path = resolve(root, 'extensions', directory.name, 'extension.json');
        if (!existsSync(path)) continue;
        const manifest = validateManifest(JSON.parse(readFileSync(path, 'utf8')));
        if (manifest.kind !== 'ui') continue;
        if (manifest.id !== directory.name) throw new Error('UI package folder must match manifest ID');
        const key = manifest.entry!.slice(0, -3);
        if (reservedRuntimeEntry(manifest.entry!) || ['react-gtk', 'core', 'extensions', 'updates', 'panel-view', 'launcher-view', 'background-view', 'react-demo', 'renderer-test',
            'desktop-ui-test', 'supervisor-test', 'view-test', 'core-test', 'lock-test', 'performance-test', 'main', 'supervisor', 'config-test', 'extensions-test', 'updates-test', 'updates-live-test', 'store-test', 'version-request-test'].includes(key))
            throw new Error(`UI entry conflicts with base output ${manifest.entry}`);
        if (entries[key]) throw new Error(`Duplicate UI entry ${manifest.entry}`);
        const source = `extensions/${manifest.id}/extension`;
        entries[key] = existsSync(resolve(root, `${source}.tsx`)) ? `${source}.tsx` : `${source}.ts`;
    }
    return entries;
}
function checkTypes(emit = false): void {
    const compiler = resolve(root, 'node_modules/typescript/bin/tsc');
    const tooling = spawnSync(process.execPath, [compiler, '--project', 'tsconfig.tools.json'], {cwd: root, stdio: 'inherit'});
    if (tooling.error) throw tooling.error;
    if (tooling.status !== 0) throw new Error('Build tooling type check failed');
    const editor = spawnSync(process.execPath, [compiler, '--project', 'tsconfig.editor.json'], {cwd: root, stdio: 'inherit'});
    if (editor.error) throw editor.error;
    if (editor.status !== 0) throw new Error('Monaco browser type check failed');
    const args = emit ? ['--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--outDir', 'dist/types'] : ['--noEmit'];
    const result = spawnSync(process.execPath, [compiler, ...args], {cwd: root, stdio: 'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('TypeScript check failed');
    if (emit) {
        mkdirSync(resolve(root, 'dist'), {recursive: true});
        for (const name of libraryNames) writeFileSync(resolve(root, `dist/${runtimeName(name)}.d.ts`), `export * from './types/packages/${name}/index.js';\n`);
        writeFileSync(resolve(root, 'dist/core.d.ts'), "export * from './types/packages/core/index.js';\n");
        writeFileSync(resolve(root, 'dist/react-gtk.d.ts'), "export * from './types/packages/core/index.js';\n");
    }
}
const options: BuildOptions = {
    absWorkingDir: root,
    entryPoints: {...libraryEntries(), ...uiEntries(), 'react-gtk': 'packages/core/compat.ts',
        'panel-view': 'packages/compat/panel-view.tsx', 'react-demo': 'examples/Counter.tsx',
        'launcher-view': 'packages/compat/launcher-view.tsx', 'background-view': 'packages/compat/background-view.tsx',
        'lock-test': 'tests/lock.test.ts', 'renderer-test': 'tests/renderer.test.tsx', 'view-test': 'tests/view.test.tsx', 'core-test': 'tests/core.test.ts', 'supervisor-test': 'tests/supervisor.test.ts', 'desktop-ui-test': 'tests/desktop-ui.test.tsx', 'performance-test': 'tests/performance.test.tsx',
        main: 'src/main.ts', supervisor: 'packages/supervisor/entry.ts', 'config-test': 'tests/config.test.ts',
        'extensions-test': 'tests/extensions.test.ts', 'updates-test': 'tests/updates.test.ts', 'updates-live-test': 'tests/updates-live.test.ts', 'store-test': 'tests/store.test.ts', 'version-request-test': 'tests/version-request.test.ts'},
    // Desktop UI tests use the same external React runtime as every view.
    outdir: resolve(root, 'dist'), bundle: true, splitting: true, format: 'esm', platform: 'neutral',
    // Flat chunks preserve config.ts's import.meta.url fallback for ROOT.
    mainFields: ['module', 'main'], target: 'firefox115', jsx: 'transform',
    minify: !development, keepNames: true,
    metafile: true,
    external: ['gi://*', 'cairo', 'system', '../dist/*.js'],
    plugins: [{name: 'typecheck', setup(builder) {
        builder.onStart(() => { checkTypes(true); });
    }}, {name: 'native-react', setup(builder) {
        builder.onResolve({filter: /^@dev-os\/([\w-]+)(?:\/([\w/-]+))?$/}, args => {
            const [, name, subpath] = args.path.match(/^@dev-os\/([^/]+)(?:\/(.+))?$/)!;
            if (!libraryNames.includes(name)) return;
            return {path: `./${runtimeName(name, subpath)}.js`, external: true};
        });
    }}],
    define: {'process.env.NODE_ENV': JSON.stringify(development ? 'development' : 'production'), '__DEV_OS_VERSION__': JSON.stringify(releaseVersion)},
    logLevel: 'info',
};
const editorOptions: BuildOptions = {
    absWorkingDir: root, entryPoints: {'app': 'extensions/org.devos.editor/browser/index.tsx',
        'editor.worker': 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js',
        'ts.worker': 'node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js',
        'json.worker': 'node_modules/monaco-editor/esm/vs/language/json/json.worker.js',
        'css.worker': 'node_modules/monaco-editor/esm/vs/language/css/css.worker.js',
        'html.worker': 'node_modules/monaco-editor/esm/vs/language/html/html.worker.js'},
    outdir: resolve(root, 'dist/editor'), bundle: true, format: 'iife', platform: 'browser',
    target: 'safari16', jsx: 'automatic', minify: true, loader: {'.ttf': 'file'},
    metafile: true,
    define: {'process.env.NODE_ENV': '"production"'}, logLevel: 'info',
};
mkdirSync(resolve(root, 'dist/editor'), {recursive: true});
writeFileSync(resolve(root, 'dist/editor/index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
if (process.argv.includes('--watch')) {
    const editorSession = await context(editorOptions); await editorSession.watch();
    const session = await context(options); await session.watch();
    console.log('Watching TypeScript / TSX files. Restart the shell after a rebuild.');
} else {
    const shellResult = await build(options), editorResult = await build(editorOptions);
    writeFileSync(resolve(root, 'dist/build-info.json'), JSON.stringify({version: releaseVersion}) + '\n');
    const paths = [...Object.keys(shellResult.metafile!.outputs), ...Object.keys(editorResult.metafile!.outputs),
        'dist/editor/index.html', 'dist/react-gtk.d.ts', ...libraryNames.map(name => `dist/${runtimeName(name)}.d.ts`), 'dist/build-info.json'];
    const outputs = paths.map(path => {
        const stat = statSync(resolve(root, path));
        return {path: path.replaceAll('\\', '/'), size: stat.size, mtimeMs: stat.mtimeMs};
    });
    mkdirSync(resolve(root, 'build'), {recursive: true});
    writeFileSync(cacheFile, JSON.stringify({fingerprint, outputs}) + '\n');
}
