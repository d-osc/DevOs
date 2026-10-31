import {libraryEntries, libraryNames, runtimeName, reservedRuntimeEntry} from './packages.ts';
import type {BuildOptions} from 'esbuild';
import {build, context} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateManifest} from '../../packages/extensions/schema.ts';
import {version} from '../../packages/updates/protocol.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const development = process.argv.includes('--watch') || process.argv.includes('--development');
const releaseVersion = version(process.env.DEV_OS_RELEASE_VERSION ?? JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version);
const cacheFile = resolve(root, 'build/build-cache.json');
function inputFingerprint(): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify({releaseVersion, development, platform: process.platform, arch: process.arch}));
    const sources: string[] = [];
    const scan = (path: string) => {
        for (const entry of readdirSync(resolve(root, path), {withFileTypes: true})) {
            const child = `${path}/${entry.name}`;
            if (entry.isDirectory() && !['.dev-cache', 'build', 'node_modules', '__pycache__'].includes(entry.name)) scan(child);
            else if (entry.isFile() && /\.(?:ts|tsx|json|css|dev|devx|don|sh|c)$/.test(entry.name)) sources.push(child);
        }
    };
    for (const path of ['src', 'packages', 'examples', 'tests', 'tools', 'lib', 'native', 'data/themes', 'distro/oe/meta-devos/recipes-devos/splash/files']) scan(path);
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
    const apps = spawnSync('sh', ['tools/build/native-apps.sh'], {cwd: root, stdio: 'inherit'});
    if (apps.error) throw apps.error;
    if (apps.status !== 0) throw new Error('Native DevLang app build failed');
    const native = spawnSync('sh', ['tools/setup/bootstrap-window-tracker.sh'], {cwd: root, stdio: 'inherit'});
    if (native.error) throw native.error;
    if (native.status !== 0) throw new Error('Wayland window tracker build failed');
}
function uiEntries(): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const folder of ['src/apps', 'src/system']) {
        for (const directory of readdirSync(resolve(root, folder), {withFileTypes: true})) {
            if (!directory.isDirectory()) continue;
            const path = resolve(root, folder, directory.name, 'extension.json');
            if (!existsSync(path)) continue;
            const manifest = validateManifest(JSON.parse(readFileSync(path, 'utf8')));
            if (manifest.kind !== 'ui' || manifest.native) continue;
            if (manifest.id !== directory.name) throw new Error('UI package folder must match manifest ID');
            const key = manifest.entry!.slice(0, -3);
            if (reservedRuntimeEntry(manifest.entry!) || ['app-host', 'app-service-host', 'services-host', 'react-gtk', 'core', 'extensions', 'updates', 'panel-view', 'launcher-view', 'background-view', 'react-demo', 'renderer-test',
                'desktop-ui-test', 'supervisor-test', 'view-test', 'core-test', 'lock-test', 'performance-test', 'main', 'supervisor', 'config-test', 'extensions-test', 'updates-test', 'updates-live-test', 'store-test', 'version-request-test'].includes(key))
                throw new Error(`UI entry conflicts with base output ${manifest.entry}`);
            if (entries[key]) throw new Error(`Duplicate UI entry ${manifest.entry}`);
            const source = `${folder}/${manifest.id}/extension`;
            entries[key] = existsSync(resolve(root, `${source}.tsx`)) ? `${source}.tsx` : `${source}.ts`;
        }
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
        
        'services-host': 'src/services/services-host.ts',

        'window-shape-test': 'tests/window-shape.test.ts', 'window-buffer-test': 'tests/window-buffer.test.tsx',
        'power-loading-test': 'tests/power-loading.test.ts',
        'native-action-test': 'tests/native-action.test.ts',
        'process-isolation-test': 'tests/process-isolation.test.ts',
        
        
        'lid-test': 'tests/lid.test.ts', 'react-demo': 'examples/Counter.tsx', 'desktop-animation-native-test': 'tests/desktop-animation-native.test.ts',
        'touchpad-live-test': 'tests/touchpad-live.test.ts', 'task-view-native-test': 'tests/task-view-native.test.ts', 'icons-settings-test': 'tests/icons-settings.test.tsx', 'devos-icon-test': 'tests/devos-icon.test.ts', 'fa-icons-test': 'tests/fa-icons.test.tsx', 'theme-settings-test': 'tests/theme-settings.test.tsx', 'theme-test': 'tests/theme.test.ts', 'theme-css-test': 'tests/theme-css.test.ts', 'clock-settings-test': 'tests/clock-settings.test.tsx', 'lock-test': 'tests/lock.test.ts', 'sleep-test': 'tests/sleep.test.ts', 'renderer-test': 'tests/renderer.test.tsx', 'view-test': 'tests/view.test.tsx', 'core-test': 'tests/core.test.ts', 'supervisor-test': 'tests/supervisor.test.ts', 'performance-test': 'tests/performance.test.tsx',
        main: 'src/main.ts', supervisor: 'packages/supervisor/entry.ts', 'config-test': 'tests/config.test.ts',
        'extensions-test': 'tests/extensions.test.ts', 'updates-test': 'tests/updates.test.ts', 'updates-live-test': 'tests/updates-live.test.ts', 'store-test': 'tests/store.test.ts', 'version-request-test': 'tests/version-request.test.ts', 'updates-patch-test': 'tests/updates-patch.test.ts', 'update-package-test': 'tests/update-package.test.ts', 'make-patch': 'packages/updates/make-patch.ts', 'make-system-bundle': 'packages/updates/make-system-bundle.ts', 'system-update-test': 'tests/system-update.test.ts', },
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
    absWorkingDir: root, entryPoints: {'app': 'src/apps/org.devos.editor/browser/index.tsx',
        'editor.worker': 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js',
        'ts.worker': 'node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js',
        'json.worker': 'node_modules/monaco-editor/esm/vs/language/json/json.worker.js',
        'css.worker': 'node_modules/monaco-editor/esm/vs/language/css/css.worker.js',
        'html.worker': 'node_modules/monaco-editor/esm/vs/language/html/html.worker.js'},
    // Preserve Monaco's lazy language imports instead of inlining every language
    // into the first script parsed on a cold Live USB boot.
    outdir: resolve(root, 'dist/editor'), bundle: true, format: 'esm', splitting: true, platform: 'browser',
    target: 'safari16', jsx: 'automatic', minify: true, loader: {'.ttf': 'dataurl'},
    metafile: true,
    define: {'process.env.NODE_ENV': '"production"'}, logLevel: 'info',
};
mkdirSync(resolve(root, 'dist/editor'), {recursive: true});
writeFileSync(resolve(root, 'dist/editor/index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script type="module" src="app.js"></script></body></html>');
if (process.argv.includes('--watch')) {
    const editorSession = await context(editorOptions); await editorSession.watch();
    const session = await context(options); await session.watch();
    console.log('Watching TypeScript / TSX files. Restart the shell after a rebuild.');
} else {
    const shellResult = await build(options), editorResult = await build(editorOptions);
    // The system background is native; remove its obsolete generated GJS entry.
    rmSync(resolve(root, 'dist/org.devos.background.js'), {force: true});
    rmSync(resolve(root, 'dist/org.devos.displaycare.js'), {force: true});
    rmSync(resolve(root, 'dist/org.devos.panel.js'), {force: true});
    rmSync(resolve(root, 'dist/display-care-shell-test.js'), {force: true});
    writeFileSync(resolve(root, 'dist/build-info.json'), JSON.stringify({version: releaseVersion}) + '\n');
    const paths = [...Object.keys(shellResult.metafile!.outputs), ...Object.keys(editorResult.metafile!.outputs),
        'dist/editor/index.html', 'dist/react-gtk.d.ts', ...libraryNames.map(name => `dist/${runtimeName(name)}.d.ts`), 'dist/build-info.json'];
    if (process.platform === 'linux') paths.push('dist/native/taskmanager','dist/native/diskmanager','dist/native/installer','dist/native/system-displaycare','dist/native/system-background','dist/native/system-panel','dist/native/panel','dist/native/panel-settings','dist/native/panel-layout-preview','dist/native/libpanel-clock.so','dist/native/libpanel-taskbar.so','dist/native/background','dist/native/background-settings','dist/native/background-settings-preview','dist/native/libbackground-image.so','dist/native/libsupervisor.so','dist/native/boot-splash',...['vscode','github'].flatMap(family=>['dark','light'].map(mode=>`dist/native/theme.${family}.${mode}.css`)));
    const outputs = paths.map(path => {
        const stat = statSync(resolve(root, path));
        return {path: path.replaceAll('\\', '/'), size: stat.size, mtimeMs: stat.mtimeMs};
    });
    mkdirSync(resolve(root, 'build'), {recursive: true});
    writeFileSync(cacheFile, JSON.stringify({fingerprint, outputs}) + '\n');
}
