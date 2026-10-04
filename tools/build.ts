import type {BuildOptions} from 'esbuild';
import {build, context} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync} from 'node:fs';
import {validateManifest} from '../src/extensions/schema.ts';
import {version} from '../src/updates/protocol.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const releaseVersion = version(process.env.DEV_OS_RELEASE_VERSION ?? JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version);
if (process.platform === 'linux') {
    const native = spawnSync('sh', ['tools/bootstrap-window-tracker.sh'], {cwd: root, stdio: 'inherit'});
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
        if (['react-gtk', 'panel-view', 'launcher-view', 'background-view', 'react-demo', 'renderer-test',
            'desktop-ui-test', 'main', 'supervisor', 'config-test', 'extensions-test', 'updates-test', 'updates-live-test'].includes(key))
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
        writeFileSync(resolve(root, 'dist/react-gtk.d.ts'), "export * from './types/packages/react-gtk/index.js';\n");
    }
}
const options: BuildOptions = {
    absWorkingDir: root,
    entryPoints: {...uiEntries(), 'react-gtk': 'packages/react-gtk/index.ts',
        'panel-view': 'src/panel-view.tsx', 'react-demo': 'examples/Counter.tsx',
        'launcher-view': 'src/launcher-view.tsx', 'background-view': 'src/background-view.tsx',
        'renderer-test': 'tests/renderer.test.tsx', 'desktop-ui-test': 'tests/desktop-ui.test.tsx',
        main: 'src/main.ts', supervisor: 'src/supervisor.ts', 'config-test': 'tests/config.test.ts',
        'extensions-test': 'tests/extensions.test.ts', 'updates-test': 'tests/updates.test.ts', 'updates-live-test': 'tests/updates-live.test.ts'},
    // Desktop UI tests use the same external React runtime as every view.
    outdir: resolve(root, 'dist'), bundle: true, splitting: true, format: 'esm', platform: 'neutral',
    // Flat chunks preserve config.ts's import.meta.url fallback for ROOT.
    mainFields: ['module', 'main'], target: 'firefox115', jsx: 'transform',
    external: ['gi://*', 'cairo', 'system', '../dist/*.js'],
    plugins: [{name: 'typecheck', setup(builder) {
        builder.onStart(() => { checkTypes(true); });
    }}, {name: 'native-react', setup(builder) {
        builder.onResolve({filter: /^@dev-os\/react-gtk$/}, () => ({path: './react-gtk.js', external: true}));
    }}],
    define: {'process.env.NODE_ENV': '"development"', '__DEV_OS_VERSION__': JSON.stringify(releaseVersion)},
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
    define: {'process.env.NODE_ENV': '"production"'}, logLevel: 'info',
};
mkdirSync(resolve(root, 'dist/editor'), {recursive: true});
writeFileSync(resolve(root, 'dist/editor/index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
if (process.argv.includes('--watch')) {
    const editorSession = await context(editorOptions); await editorSession.watch();
    const session = await context(options); await session.watch();
    console.log('Watching TypeScript / TSX files. Restart the shell after a rebuild.');
} else {
    await build(options); await build(editorOptions);
    writeFileSync(resolve(root, 'dist/build-info.json'), JSON.stringify({version: releaseVersion}) + '\n');
}
