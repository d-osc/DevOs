import {readFileSync, mkdirSync, cpSync, chmodSync, readdirSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {version, platform} from '../../packages/updates/protocol.ts';

if (process.platform !== 'linux') throw new Error('Package releases on Linux, using Node.js 24+ and the compiled Linux window tracker.');
const root = process.cwd(), output = resolve(root, 'build/release');
const target = platform(process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch);
const name = version(process.env.DEV_OS_RELEASE_VERSION ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
if (JSON.parse(readFileSync(join(root, 'dist/build-info.json'), 'utf8')).version !== name) throw new Error('Build version differs from release version. Rebuild with DEV_OS_RELEASE_VERSION.');
const temporary = mkdtempSync(join(tmpdir(), 'dev-os-release-'));
try {
    const destination = join(temporary, 'dev-os');
    mkdirSync(destination);
    for (const directory of ['bin', 'dist', 'data', 'config', 'extensions']) cpSync(join(root, directory), join(destination, directory), {
        recursive: true, dereference: false,
        filter: source => !source.endsWith('.pyc') && !source.includes('__pycache__') && !source.endsWith('-test.js') && !source.includes('/dist/types'),
    });
    mkdirSync(join(destination, 'native'));
    cpSync(join(root, 'build/native/dev-os-window-tracker'), join(destination, 'native/dev-os-window-tracker'));
    chmodSync(join(destination, 'native/dev-os-window-tracker'), 0o755);
    for (const entry of readdirSync(join(destination, 'bin'))) chmodSync(join(destination, 'bin', entry), 0o755);
    writeFileSync(join(destination, 'release.json'), JSON.stringify({format: 1, version: name, platform: target}, null, 2) + '\n');
    mkdirSync(output, {recursive: true});
    const asset = `dev-os-${target}.tar.gz`, archive = join(output, asset);
    const result = spawnSync('tar', ['--format=gnu', '-czf', archive, '-C', temporary, 'dev-os'], {stdio: 'inherit'});
    if (result.status !== 0) throw new Error('Could not create release archive');
    const sha = createHash('sha256').update(readFileSync(archive)).digest('hex');
    writeFileSync(join(output, 'SHA256SUMS'), `${sha}  ${asset}\n`);
    console.log(`Release ${name}: ${archive}`);
} finally { rmSync(temporary, {recursive: true, force: true}); }
