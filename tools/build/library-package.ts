import {libraryNames} from './packages.ts';
import {build} from 'esbuild';
import {readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, rmSync, existsSync} from 'node:fs';
import {resolve, dirname, relative, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const name = process.argv[2] ?? 'core';
if (!libraryNames.includes(name)) throw new Error('Unknown library package');
const output = resolve(root, `build/${name}-package`);
const stage = mkdtempSync(join(tmpdir(), 'dev-os-core-package-'));
function run(command: string, args: string[], cwd = root): void {
    const result = spawnSync(command, args, {cwd, stdio: 'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
try {
    const declarations = join(stage, 'declarations');
    const packageRoot = join(stage, 'package');
    mkdirSync(join(packageRoot, 'dist'), {recursive: true});
    run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', 'false',
        '--declaration', '--emitDeclarationOnly', '--outDir', declarations]);
    const seen = new Set<string>();
    function copyDeclaration(path: string): void {
        if (seen.has(path)) return;
        seen.add(path);
        const contents = readFileSync(path, 'utf8').replace(/(['"])@dev-os\/([\w-]+)(?:\/([\w/-]+))?\1/g, (_match, quote: string, library: string, subpath: string | undefined) => {
            if (library !== name) return _match;
            const target = join(declarations, 'packages', library, (subpath ?? 'index') + '.d.ts');
            let specifier = relative(dirname(path), target).replaceAll('\\', '/').replace(/\.d\.ts$/, '.js');
            if (!specifier.startsWith('.')) specifier = './' + specifier;
            return quote + specifier + quote;
        });
        const destination = join(packageRoot, 'dist/types', relative(declarations, path));
        mkdirSync(dirname(destination), {recursive: true});
        writeFileSync(destination, contents);
        for (const match of contents.matchAll(/['"](\.[^'"]+\.js)['"]/g))
            copyDeclaration(resolve(dirname(path), match[1].replace(/\.js$/, '.d.ts')));
    }
    copyDeclaration(join(declarations, `packages/${name}/index.d.ts`));
    writeFileSync(join(packageRoot, 'dist/index.d.ts'),
        `export * from './types/packages/${name}/index.js';\n`);
    for (const key of Object.keys(JSON.parse(readFileSync(resolve(root, `packages/${name}/package.json`), 'utf8')).exports)) {
        if (key === '.') continue;
        copyDeclaration(join(declarations, 'packages', name, key.slice(2) + '.d.ts'));
        const wrapper = join(packageRoot, 'dist', key.slice(2) + '.d.ts');
        const target = join(packageRoot, 'dist/types/packages', name, key.slice(2) + '.js');
        let specifier = relative(dirname(wrapper), target).replaceAll('\\', '/');
        if (!specifier.startsWith('.')) specifier = './' + specifier;
        mkdirSync(dirname(wrapper), {recursive: true});
        writeFileSync(wrapper, `export * from '${specifier}';\n`);
    }
    const result = await build({absWorkingDir: root, entryPoints: Object.fromEntries(Object.keys(JSON.parse(readFileSync(resolve(root, `packages/${name}/package.json`), 'utf8')).exports).map(key => [key === '.' ? 'index' : key.slice(2), `packages/${name}/${key === '.' ? 'index' : key.slice(2)}${existsSync(resolve(root, `packages/${name}/${key === '.' ? 'index' : key.slice(2)}.tsx`)) ? '.tsx' : '.ts'}`])),
        outdir: join(packageRoot, 'dist'), bundle: true, splitting: name !== 'core',
        format: 'esm', platform: 'neutral', target: 'firefox115', minify: true, keepNames: true,
        external: ['gi://*', 'cairo', 'system', ...(name === 'core' ? [] : Object.keys(JSON.parse(readFileSync(resolve(root, `packages/${name}/package.json`), 'utf8')).dependencies))], metafile: true,
        define: {'process.env.NODE_ENV': '"production"', '__DEV_OS_VERSION__': JSON.stringify(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version)}, logLevel: 'info'});
    const dependencies = name === 'core' ? ['react', 'react-reconciler', 'scheduler'] : [];
    for (const name of dependencies) {
        if (!Object.keys(result.metafile!.inputs).some(path => path.startsWith(`node_modules/${name}/`)))
            throw new Error(`Missing bundled dependency: ${name}`);
    }
    for (const file of Object.values(result.metafile!.outputs))
        for (const dependency of file.imports)
            if (!dependency.path.startsWith('gi://') && !['cairo', 'system'].includes(dependency.path) && !(name !== 'core' && (dependency.path.startsWith('@dev-os/') || !dependency.external)))
                throw new Error(`Unexpected runtime import: ${dependency.path}`);
    for (const file of ['package.json', 'README.md'])
        cpSync(resolve(root, `packages/${name}`, file), join(packageRoot, file));
    writeFileSync(join(packageRoot, 'THIRD_PARTY_NOTICES.md'), dependencies.map(name => {
        const metadata = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8'));
        return `# ${name} ${metadata.version}\n\n` + readFileSync(resolve(root, 'node_modules', name, 'LICENSE'), 'utf8');
    }).join('\n\n'));
    mkdirSync(output, {recursive: true});
    // Invoke npm through Node so packing also works on Windows without a shell.
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error('Run this tool with npm run core:pack');
    run(process.execPath, [npm, 'pack', packageRoot, '--pack-destination', output, '--ignore-scripts']);
    console.log(`@dev-os/${name} package: ${output}`);
} finally {
    rmSync(stage, {recursive: true, force: true});
}
