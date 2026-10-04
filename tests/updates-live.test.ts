import GLib from 'gi://GLib';
import System from 'system';
import {Updates} from '../src/updates/service.js';

// Run only through tools/update-smoke.py: an isolated root, real GitHub API and
// the production HTTPS downloader. Never change the current user's selection.
const base = ARGV[0];
if (!base || !/^\/tmp\/dev-os-live-update-[A-Za-z0-9_-]+$/.test(base)) throw new Error('A private live-update test directory is required');
const updater = new Updates({root: `${base}/data/dev-os-updates`, running: '0.0.0', repository: () => 'd-osc/DevOs'});
const loop = new GLib.MainLoop(null, false);
let failed: unknown;
async function main() {
    await updater.check();
    if (!updater.canInstall || !updater.state.release) throw new Error(updater.state.error || updater.state.message);
    const release = updater.state.release;
    print(`PASS: real GitHub release ${release.tag}, ${release.platform}, ${release.size} bytes`);
    await updater.install();
    if (updater.state.status !== 'ready') throw new Error(updater.state.error || updater.state.message);
    GLib.file_set_contents(`${base}/result.json`, JSON.stringify({version: release.version, tag: release.tag, url: release.url,
        sha256: release.sha256, size: release.size, installed: updater.state.installed, source: 'GitHub API and HTTPS download'}, null, 2));
    print('PASS: production HTTPS download, SHA-256 verification and atomic installation');
}
void main().catch(error => { failed = error; }).finally(() => { updater.dispose(); loop.quit(); });
loop.run();
if (failed) { printerr(String(failed)); System.exit(1); }
