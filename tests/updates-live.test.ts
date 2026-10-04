import GLib from 'gi://GLib';
import System from 'system';
import {Updates} from '../src/updates/service.js';
import {run, type UpdateTransport} from '../src/updates/service.js';
import Gio from 'gi://Gio';

// Run only through tools/update-smoke.py: an isolated root, real GitHub API and
// the production HTTPS downloader. Never change the current user's selection.
const base = ARGV[0];
if (!base || !/^\/tmp\/dev-os-live-update-[A-Za-z0-9_-]+$/.test(base)) throw new Error('A private live-update test directory is required');
let updater: Updates;
const loop = new GLib.MainLoop(null, false);
let failed: unknown;
async function main() {
    const packaged = GLib.getenv('DEV_OS_UPDATE_TEST_PACKAGE');
    let transport: UpdateTransport | undefined;
    if (packaged) {
        const cancel = new Gio.Cancellable();
        const metadata = JSON.parse(await run(['tar', '-xOf', packaged, 'dev-os/release.json'], cancel)) as {version: string; platform: string};
        const size = Gio.File.new_for_path(packaged).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
        const sha = (await run(['sha256sum', '--', packaged], cancel)).split(/\s+/)[0];
        const asset = `dev-os-${metadata.platform}.tar.gz`;
        transport = {
            async get() { return {status: 200, body: {tag_name: `v${metadata.version}`, assets: [{name: asset, state: 'uploaded', size, digest: `sha256:${sha}`,
                browser_download_url: `https://github.com/d-osc/DevOs/releases/download/v${metadata.version}/${asset}`}]}}; },
            async download(_release, path) { Gio.File.new_for_path(packaged).copy(Gio.File.new_for_path(path), Gio.FileCopyFlags.NONE, null, null); },
        };
    }
    updater = new Updates({root: `${base}/data/dev-os-updates`, running: '0.0.0', repository: () => 'd-osc/DevOs', transport});
    await updater.check();
    if (!updater.canInstall || !updater.state.release) throw new Error(updater.state.error || updater.state.message);
    const release = updater.state.release;
    print(`PASS: ${packaged ? 'local release artifact' : 'real GitHub release'} ${release.tag}, ${release.platform}, ${release.size} bytes`);
    await updater.install();
    if (updater.state.status !== 'ready') throw new Error(updater.state.error || updater.state.message);
    GLib.file_set_contents(`${base}/result.json`, JSON.stringify({version: release.version, tag: release.tag, url: release.url,
        sha256: release.sha256, size: release.size, installed: updater.state.installed, source: packaged ? 'Local release artifact' : 'GitHub API and HTTPS download'}, null, 2));
    print(`PASS: ${packaged ? 'real package' : 'production HTTPS download'}, SHA-256 verification and atomic installation`);
}
void main().catch(error => { failed = error; }).finally(() => { updater?.dispose(); loop.quit(); });
loop.run();
if (failed) { printerr(String(failed)); System.exit(1); }
