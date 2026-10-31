import type {BuildOptions} from 'esbuild';
import {build, context} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';

// A release version is plain semver (an optional leading v is dropped).
function releaseName(value: string): string {
    const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(value.trim());
    if (!match) throw new Error(`Invalid release version ${value}`);
    return match[1];
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const development = process.argv.includes('--watch') || process.argv.includes('--development');
const releaseVersion = releaseName(process.env.DEV_OS_RELEASE_VERSION ?? JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version);
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
    for (const path of ['src', 'packages', 'tests', 'tools', 'lib', 'native', 'data/themes', 'distro/oe/meta-devos/recipes-devos/splash/files']) scan(path);
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
function checkTypes(): void {
    const compiler = resolve(root, 'node_modules/typescript/bin/tsc');
    const tooling = spawnSync(process.execPath, [compiler, '--project', 'tsconfig.tools.json'], {cwd: root, stdio: 'inherit'});
    if (tooling.error) throw tooling.error;
    if (tooling.status !== 0) throw new Error('Build tooling type check failed');
    const editor = spawnSync(process.execPath, [compiler, '--project', 'tsconfig.editor.json'], {cwd: root, stdio: 'inherit'});
    if (editor.error) throw editor.error;
    if (editor.status !== 0) throw new Error('Monaco browser type check failed');
    const result = spawnSync(process.execPath, [compiler, '--noEmit'], {cwd: root, stdio: 'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('TypeScript check failed');
}
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
checkTypes();
mkdirSync(resolve(root, 'dist/editor'), {recursive: true});
writeFileSync(resolve(root, 'dist/editor/index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script type="module" src="app.js"></script></body></html>');
if (process.argv.includes('--watch')) {
    const editorSession = await context(editorOptions); await editorSession.watch();
    console.log('Watching TypeScript / TSX files. Restart the shell after a rebuild.');
} else {
    const editorResult = await build(editorOptions);
    // The system background is native; remove its obsolete generated GJS entry.
    writeFileSync(resolve(root, 'dist/build-info.json'), JSON.stringify({version: releaseVersion}) + '\n');
    const paths = [...Object.keys(editorResult.metafile!.outputs),
        'dist/editor/index.html', 'dist/build-info.json'];
    if (process.platform === 'linux') paths.push('dist/native/taskmanager','dist/native/diskmanager','dist/native/installer','dist/native/system-displaycare','dist/native/system-background','dist/native/system-panel','dist/native/panel','dist/native/panel-settings','dist/native/panel-layout-preview','dist/native/libpanel-clock.so','dist/native/libpanel-taskbar.so','dist/native/background','dist/native/background-settings','dist/native/background-settings-preview','dist/native/libbackground-image.so','dist/native/libsupervisor.so','dist/native/boot-splash',...['vscode','github'].flatMap(family=>['dark','light'].map(mode=>`dist/native/theme.${family}.${mode}.css`)));
    const outputs = paths.map(path => {
        const stat = statSync(resolve(root, path));
        return {path: path.replaceAll('\\', '/'), size: stat.size, mtimeMs: stat.mtimeMs};
    });
    mkdirSync(resolve(root, 'build'), {recursive: true});
    writeFileSync(cacheFile, JSON.stringify({fingerprint, outputs}) + '\n');
}
