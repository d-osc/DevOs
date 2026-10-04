import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {ROOT} from '../src/config.js';
import {Updates, type UpdateTransport} from '../src/updates/service.js';
import {newer, parseRelease, validateArchive, repository, type Release} from '../src/updates/protocol.js';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function fails(callback: () => unknown) { let failed = false; try { callback(); } catch { failed = true; } assert(failed, 'Expected rejection'); }
function run(args: string[], environment?: Record<string, string>): string {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
    for (const [key, value] of Object.entries(environment ?? {})) launcher.setenv(key, value, true);
    const child = launcher.spawnv(args), [, output, error] = child.communicate_utf8(null, null);
    assert(child.get_successful(), error || 'Command failed'); return output?.trim() ?? '';
}
function write(path: string, value: string, executable = false) {
    GLib.mkdir_with_parents(Gio.File.new_for_path(path).get_parent()!.get_path()!, 0o700);
    GLib.file_set_contents(path, value);
    if (executable) Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', 0o755, Gio.FileQueryInfoFlags.NONE, null);
}
function fixture(base: string, releaseVersion: string): {archive: string; release: Record<string, unknown>} {
    const directory = `${base}/${releaseVersion}`;
    for (const name of ['main', 'supervisor', 'react-gtk']) write(`${directory}/dev-os/dist/${name}.js`, '// test runtime\n');
    for (const name of ['dev-os-session', 'dev-os-shell', 'dev-os-start']) write(`${directory}/dev-os/bin/${name}`, `#!/bin/sh\nprintf '%s\\n' '${releaseVersion}'\n`, true);
    write(`${directory}/dev-os/native/dev-os-window-tracker`, '#!/bin/sh\nexit 0\n', true);
    write(`${directory}/dev-os/release.json`, JSON.stringify({format: 1, version: releaseVersion, platform: 'linux-x64'}));
    const archive = `${base}/${releaseVersion}.tar.gz`;
    run(['tar', '-czf', archive, '-C', directory, 'dev-os']);
    const size = Gio.File.new_for_path(archive).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
    const sha = run(['sha256sum', '--', archive]).split(/\s+/)[0];
    return {archive, release: {tag_name: `v${releaseVersion}`, draft: false, prerelease: false, body: 'Test release', assets: [
        {name: 'dev-os-linux-x64.tar.gz', state: 'uploaded', size, digest: `sha256:${sha}`,
            browser_download_url: `https://github.com/d-osc/DevOs/releases/download/v${releaseVersion}/dev-os-linux-x64.tar.gz`},
    ]}};
}
function clean(path: string) {
    const file = Gio.File.new_for_path(path);
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
        const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        try { for (let child = children.next_file(null); child; child = children.next_file(null)) clean(`${path}/${child.get_name()}`); }
        finally { children.close(null); }
    }
    file.delete(null);
}
async function main() {
    assert(newer('0.10.0', '0.2.0') && !newer('0.2.0', '0.10.0') && !newer('0.2.0', '0.2.0'), 'Numeric semver comparison');
    fails(() => repository('d-osc/../../etc')); fails(() => newer('v1.2.3-beta', '0.2.0'));
    const base = GLib.dir_make_tmp('dev-os-updates-test-XXXXXX');
    let updater: Updates | undefined;
    try {
        const first = fixture(base, '0.3.0'), second = fixture(base, '0.4.0');
        let selected = first, downloads = 0;
        const transport: UpdateTransport = {
            async get() { return {status: 200, body: selected.release}; },
            async download(_release: Release, target: string) { downloads++; Gio.File.new_for_path(selected.archive).copy(Gio.File.new_for_path(target), Gio.FileCopyFlags.NONE, null, null); },
        };
        const root = `${base}/data/dev-os-updates`;
        updater = new Updates({repository: () => 'd-osc/DevOs', root, transport, running: '0.2.0'});
        const parsed = parseRelease(first.release, 'd-osc/DevOs', 'linux-x64');
        fails(() => parseRelease({...first.release, prerelease: true}, 'd-osc/DevOs', 'linux-x64'));
        fails(() => parseRelease(first.release, 'another/repo', 'linux-x64'));
        fails(() => parseRelease(first.release, 'd-osc/DevOs', 'linux-arm64'));
        assert(parsed.version === '0.3.0', 'Parse a verified stable asset');
        const names = run(['tar', '-tzf', first.archive]), details = run(['tar', '-tvzf', first.archive, '--numeric-owner']);
        validateArchive(names, details);
        fails(() => validateArchive(names.replace('dev-os/release.json', 'dev-os/../outside'), details));
        fails(() => validateArchive(names, details.replace(/^-/m, 'l')));
        print('PASS: update versions, repository URLs, platform selection and unsafe archive rejection');
        await updater.check(); assert(updater.state.status === 'available', updater.state.error || 'Update detected');
        await updater.install(); assert(updater.state.installed === '0.3.0' && updater.state.status === 'ready', updater.state.error || 'First release installed');
        const firstHistory = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${root}/history.json`)[1]));
        const immutableSession = `${root}/releases/${firstHistory.current.key}/bin/dev-os-session`;
        assert(run(['sh', `${ROOT}/bin/dev-os-updated-session`], {XDG_DATA_HOME: `${base}/data`}) === '0.3.0', 'Launcher uses installed selection');
        selected = second;
        await updater.check(); await updater.install();
        assert(updater.state.installed === '0.4.0' && updater.state.previous === '0.3.0', updater.state.error || 'Second release preserves rollback');
        assert(run([immutableSession]) === '0.3.0', 'Previously resolved runtime remains immutable');
        assert(run(['sh', `${ROOT}/bin/dev-os-updated-session`], {XDG_DATA_HOME: `${base}/data`}) === '0.4.0', 'Next session uses new release');
        await updater.rollback();
        assert(updater.state.installed === '0.3.0' && updater.state.previous === '0.4.0', 'Rollback swaps selected releases');
        assert(run(['sh', `${ROOT}/bin/dev-os-updated-session`], {XDG_DATA_HOME: `${base}/data`}) === '0.3.0', 'Launcher uses rolled-back version');
        print('PASS: real archive installation, immutable running versions, next-session selection and rollback');
        const goodAsset = (second.release.assets as Record<string, unknown>[])[0];
        selected = {archive: second.archive, release: {...second.release, assets: [{...goodAsset, digest: `sha256:${'0'.repeat(64)}`} ]}};
        const before = new TextDecoder().decode(GLib.file_get_contents(`${root}/history.json`)[1]);
        await updater.check(); await updater.install();
        assert(updater.state.error.includes('SHA-256') && !updater.state.busy, 'Tampered download rejected');
        assert(new TextDecoder().decode(GLib.file_get_contents(`${root}/history.json`)[1]) === before, 'Failed verification preserves selection and rollback history');
        assert(!GLib.file_test(`${root}/install.lock`, GLib.FileTest.EXISTS), 'Installer releases its lock after failure');
        assert(downloads === 3, 'Check does not download or install automatically');
        print('PASS: tamper failure preserves current install, frees lock and never auto-installs');
        const same = fixture(base, '0.2.0');
        const initial = new Updates({repository: () => 'd-osc/DevOs', root: `${base}/initial`, running: '0.2.0', transport: {
            async get() { return {status: 200, body: same.release}; },
            async download(_release, target) { Gio.File.new_for_path(same.archive).copy(Gio.File.new_for_path(target), Gio.FileCopyFlags.NONE, null, null); },
        }});
        await initial.check(); assert(initial.canInstall, 'Development checkout can install a matching first release');
        await initial.install(); assert(initial.state.managed && initial.state.status === 'ready', initial.state.error || 'Initial managed install'); initial.dispose();
        print('PASS: initial release installation works when development and release versions match');
        const missing = new Updates({repository: () => 'd-osc/DevOs', root: `${base}/empty`, running: '0.2.0', transport: {
            async get(url) { return {status: url.endsWith('/latest') ? 404 : 200, body: {}}; }, async download() { throw new Error('Should not download'); },
        }});
        await missing.check(); assert(missing.state.status === 'empty' && missing.state.error === '', 'Empty GitHub repository is distinct from a network error'); missing.dispose();
        print('PASS: repository without releases has a clear empty state');
        const corruptRoot = `${base}/corrupt`;
        write(`${corruptRoot}/history.json`, JSON.stringify({current: false, previous: null}));
        const corrupt = new Updates({repository: () => 'd-osc/DevOs', root: corruptRoot, transport, running: '0.2.0'});
        await corrupt.check(); assert(corrupt.state.status === 'error' && !corrupt.state.busy, 'Corrupt history blocks replacing the installed selection'); corrupt.dispose();
        print('PASS: corrupt installed history is reported without replacing selection');
        const packaged = GLib.getenv('DEV_OS_UPDATE_TEST_PACKAGE');
        if (packaged) {
            const metadata = JSON.parse(run(['tar', '-xOf', packaged, 'dev-os/release.json'])) as {version: string; platform: string};
            const sha = run(['sha256sum', '--', packaged]).split(/\s+/)[0];
            const size = Gio.File.new_for_path(packaged).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
            const asset = `dev-os-${metadata.platform}.tar.gz`;
            const packagedData = `${base}/packaged-data`;
            const actual = new Updates({repository: () => 'd-osc/DevOs', root: `${packagedData}/dev-os-updates`, running: '0.0.0', transport: {
                async get() { return {status: 200, body: {tag_name: `v${metadata.version}`, assets: [{name: asset, state: 'uploaded', size, digest: `sha256:${sha}`,
                    browser_download_url: `https://github.com/d-osc/DevOs/releases/download/v${metadata.version}/${asset}`}]}}; },
                async download(_release, target) { Gio.File.new_for_path(packaged).copy(Gio.File.new_for_path(target), Gio.FileCopyFlags.NONE, null, null); },
            }});
            try {
                await actual.check(); await actual.install();
                assert(actual.state.status === 'ready', actual.state.error || 'Packaged release installed');
                const doctor = run(['sh', `${ROOT}/bin/dev-os-updated-session`, '--check'], {XDG_DATA_HOME: packagedData, XDG_CONFIG_HOME: `${base}/packaged-config`});
                assert(doctor.includes('OK: react_bundle') && doctor.includes('OK: window_tracker') && doctor.includes('OK: editor_assets'), doctor);
                print('PASS: release packager artifact installs and its real updated session passes the dependency doctor');
            } finally { actual.dispose(); }
        }
    } finally { updater?.dispose(); clean(base); }
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void main().catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) { printerr(String(failed)); System.exit(1); }
print('Update integration tests passed');
