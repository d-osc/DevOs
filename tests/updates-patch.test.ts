import {Gio, GLib, removeTree} from '@dev-os/core';
import System from 'system';
import {Updates, type UpdateTransport} from '@dev-os/updates';
import {patchAssetName, releaseExtras} from '@dev-os/updates/manifest';
import {createPatch, readManifest, verifyTree} from '@dev-os/updates/package';
import {assert, run, write, read, size, pack, repack, github, sums, target, REPO, type Asset} from './update-fixtures.js';

function fakeTransport(state: {release: unknown; urls: Map<string, string>; downloads: string[]; failAfter?: string}): UpdateTransport {
    return {
        async get(url) { return {status: 200, body: url.includes('/swaywm/swaylock/') ? {tag_name: 'v1.8.6', html_url: 'https://github.com/swaywm/swaylock/releases/tag/v1.8.6'} : state.release}; },
        async download(release, path) {
            state.downloads.push(release.url.slice(release.url.lastIndexOf('/') + 1));
            const source = state.urls.get(release.url);
            if (!source) throw new Error(`Unexpected download ${release.url}`);
            if (state.failAfter && release.url.endsWith(state.failAfter)) { write(path, 'partial'); throw new Error('Connection lost'); }
            Gio.File.new_for_path(source).copy(Gio.File.new_for_path(path), Gio.FileCopyFlags.NONE, null, null);
        },
    };
}
const noKeys = '/nonexistent-dev-os-keys';
const homes: Updates[] = [];
async function main() {
    const base = GLib.dir_make_tmp('dev-os-updates-flows-XXXXXX');
    try {
        const v1 = pack(base, '0.3.0'), v2 = pack(base, '0.4.0', {'data/new.txt': 'added in 0.4.0\n', 'dist/main.js': '// 0.4.0 main changed\n'}), v3 = pack(base, '0.5.0', {'data/new.txt': 'added in 0.4.0\n'});
        const patch = `${base}/${patchAssetName('0.3.0', '0.4.0', target)}`; await createPatch(v1.archive, v2.archive, patch);
        const keys = `${base}/keys`; GLib.mkdir_with_parents(keys, 0o700);
        const privateKey = `${base}/private.pem`, other2 = `${base}/other.pem`;
        run(['openssl', 'genpkey', '-algorithm', 'ed25519', '-out', privateKey]); run(['openssl', 'pkey', '-in', privateKey, '-pubout', '-out', `${keys}/release.pub`]);
        run(['openssl', 'genpkey', '-algorithm', 'ed25519', '-out', other2]);
        const forged = sums(base, 'forged', [{name: 'a.tar.gz', path: v1.archive}], {key: other2});
        void v3;
        // ---- Updater flows (fake GitHub) ---------------------------------------------------------------------------
        const plain = (root: string, running: string, state: ReturnType<typeof fakeTransport>, extra: Partial<ConstructorParameters<typeof Updates>[0]> = {}) =>
            new Updates({repository: () => REPO, root, running, transport: state, live: () => false, keyDir: noKeys, ...extra});
        const make = (...args: Parameters<typeof plain>) => { const updater = plain(...args); homes.push(updater); return updater; };

        // Unsigned release with a patch: first install is the full package, then 0.4.0 arrives as a patch.
        const full1 = github('0.3.0', [{name: `dev-os-${target}.tar.gz`, path: v1.archive}]);
        const shared = {release: full1.release as unknown, urls: full1.urls, downloads: [] as string[]};
        const root = `${base}/home/dev-os-updates`;
        const updater = make(root, '0.2.0', fakeTransport(shared));
        await updater.check(); assert(updater.state.status === 'available' && updater.state.trust === '' && !updater.state.patch, updater.state.error || 'Full package offered first');
        await updater.install(); assert(updater.state.installed === '0.3.0' && updater.state.status === 'ready', updater.state.error || 'Full install');
        assert(await readManifest(updater.selectedRoot!) !== null && updater.state.trust === 'unsigned', 'Installed tree carries its manifest; unsigned release is reported as such');
        assert(updater.state.message.includes('Restart the shell'), 'The next step is a shell restart');
        const full2 = github('0.4.0', [{name: `dev-os-${target}.tar.gz`, path: v2.archive}, {name: patchAssetName('0.3.0', '0.4.0', target), path: patch}]);
        Object.assign(shared, {release: full2.release, urls: full2.urls, downloads: []});
        await updater.check(); assert(updater.state.patch?.from === '0.3.0', 'Check offers the patch for the installed version');
        const logged: number[] = []; updater.subscribe(() => { if (updater.state.progress !== null) logged.push(updater.state.progress); });
        await updater.install();
        assert(updater.state.installed === '0.4.0' && updater.state.previous === '0.3.0', updater.state.error || 'Patch install');
        assert(shared.downloads.join() === patchAssetName('0.3.0', '0.4.0', target), `Only the patch is downloaded: ${shared.downloads.join()}`);
        assert(logged.length > 0 && logged[logged.length - 1] === 1, 'Download progress reaches 100%');
        await verifyTree(updater.selectedRoot!, (await readManifest(updater.selectedRoot!))!, new Gio.Cancellable());
        await updater.rollback(); assert(updater.state.installed === '0.3.0' && updater.versions.some(row => row.role === 'previous' && row.version === '0.4.0'), 'Rollback selects 0.3.0 again');
        await updater.rollback(); assert(updater.state.installed === '0.4.0', 'Rolling forward works as well');
        print('PASS: install, patch update (only the patch is downloaded), progress, verification and rollback');

        // A damaged patch falls back to the full package.
        const broken = `${base}/broken-patch.tar.gz`; run(['cp', patch, broken]); write(broken, 'not a tarball');
        const v4 = pack(base, '0.6.0');
        const p4 = `${base}/${patchAssetName('0.4.0', '0.6.0', target)}`; await createPatch(v2.archive, v4.archive, p4);
        // Same size/digest as advertised, but unusable content: advertise the broken file instead.
        const fbBroken = github('0.6.0', [{name: `dev-os-${target}.tar.gz`, path: v4.archive}, {name: patchAssetName('0.4.0', '0.6.0', target), path: broken}]);
        Object.assign(shared, {release: fbBroken.release, urls: fbBroken.urls, downloads: []});
        await updater.check(); await updater.install();
        assert(updater.state.installed === '0.6.0' && shared.downloads.length === 2 && shared.downloads[1] === `dev-os-${target}.tar.gz`, updater.state.error || `Fallback to the full package: ${shared.downloads.join()}`);
        const kept = run(['ls', `${root}/releases`]).split('\n');
        assert(kept.length === 2 && !kept.some(name => name.startsWith('0.3.0')), `Older releases are pruned, current and previous are kept: ${kept.join()}`);
        print('PASS: an unusable patch falls back to the full package; old releases are pruned');

        // Signed release with a key shipped in the running Dev OS.
        const home2 = `${base}/home2/dev-os-updates`;
        const pkg = [{name: `dev-os-${target}.tar.gz`, path: v1.archive}];
        const good = sums(base, 'ok', pkg, {key: privateKey});
        const goodRelease = github('0.3.0', [...pkg, ...good]);
        const state2 = {release: goodRelease.release as unknown, urls: goodRelease.urls, downloads: [] as string[]};
        const signedUpdater = make(home2, '0.2.0', fakeTransport(state2), {keyDir: keys});
        await signedUpdater.check(); await signedUpdater.install();
        assert(signedUpdater.state.installed === '0.3.0' && signedUpdater.state.trust === 'verified', signedUpdater.state.error || 'Signed install verified');
        for (const [label, assets, text] of [
            ['unsigned', [...pkg, good[0]], 'not signed'], ['no sums', pkg, 'only installs signed'],
            ['forged', [...pkg, ...forged.map(asset => ({...asset, name: asset.name}))], 'signature is invalid'],
        ] as [string, Asset[], string][]) {
            const home = `${base}/home-${label.replace(' ', '-')}/dev-os-updates`;
            // The forged/unsigned sums must describe this package so only the signature is at fault.
            const fixed = label === 'forged' ? [...pkg, ...sums(base, 'forged-ok', pkg, {key: other2})] : assets;
            const release = github('0.3.0', fixed);
            const attempt = make(home, '0.2.0', fakeTransport({release: release.release, urls: release.urls, downloads: []}), {keyDir: keys});
            await attempt.check(); await attempt.install();
            assert(attempt.state.error.includes(text) && !attempt.state.managed && !GLib.file_test(`${home}/history.json`, GLib.FileTest.EXISTS), `${label}: ${attempt.state.error}`);
        }
        const mismatch = sums(base, 'mismatch', [{name: `dev-os-${target}.tar.gz`, path: v2.archive}], {key: privateKey});
        const mismatchRelease = github('0.3.0', [...pkg, ...mismatch]);
        const mismatching = make(`${base}/home-mismatch/dev-os-updates`, '0.2.0', fakeTransport({release: mismatchRelease.release, urls: mismatchRelease.urls, downloads: []}), {keyDir: keys});
        await mismatching.check(); await mismatching.install();
        assert(mismatching.state.error.includes('SHA256SUMS does not match') && !mismatching.state.managed, `API digest and signed SHA256SUMS must agree: ${mismatching.state.error}`);
        print('PASS: with a shipped key only correctly signed releases install (unsigned, missing sums, forged and mismatching hashes are refused)');

        // Local update files.
        const usb = `${base}/usb`; GLib.mkdir_with_parents(usb, 0o700);
        run(['cp', v2.archive, `${usb}/dev-os-${target}.tar.gz`]);
        const local = make(`${base}/home-local/dev-os-updates`, '0.3.0', fakeTransport({release: {}, urls: new Map(), downloads: []}));
        await local.installFile(`${usb}/dev-os-${target}.tar.gz`);
        assert(local.state.installed === '0.4.0' && local.state.trust === 'unsigned', local.state.error || 'Local file installs');
        await local.installFile(`${usb}/dev-os-${target}.tar.gz`); assert(local.state.error.includes('not newer'), 'The same version is not installed twice');
        await local.installFile('relative/file.tar.gz'); assert(local.state.error.includes('ending in .tar.gz'), 'Bad path is explained');
        write(`${usb}/old.tar.gz`, 'x'); await local.installFile(`${usb}/old.tar.gz`); assert(local.state.error !== '' && local.state.managed, 'A non-package file is refused');
        const downgrade = make(`${base}/home-down/dev-os-updates`, '0.4.0', fakeTransport({release: {}, urls: new Map(), downloads: []}));
        run(['cp', v1.archive, `${usb}/old.tar.gz`]); await downgrade.installFile(`${usb}/old.tar.gz`);
        assert(downgrade.state.error.includes('not newer') && !downgrade.state.managed, 'Downgrades are refused');
        // Local patch, listed in SHA256SUMS with a signature.
        const usbSigned = `${base}/usb-signed`; GLib.mkdir_with_parents(usbSigned, 0o700);
        const patchName = patchAssetName('0.3.0', '0.4.0', target); run(['cp', patch, `${usbSigned}/${patchName}`]);
        const offline = sums(base, 'usb', [{name: patchName, path: patch}], {key: privateKey});
        const noSidecar = make(`${base}/home-nos/dev-os-updates`, '0.3.0', fakeTransport({release: {}, urls: new Map(), downloads: []}), {keyDir: keys});
        await noSidecar.installFile(`${usbSigned}/${patchName}`); assert(noSidecar.state.error.includes('only installs signed'), 'With a key, a bare file is refused with instructions');
        run(['cp', offline[0].path, `${usbSigned}/SHA256SUMS`]); run(['cp', offline[1].path, `${usbSigned}/SHA256SUMS.sig`]);
        // The patch needs a managed 0.3.0 base: install it from the full package first.
        const patched = make(`${base}/home-patched/dev-os-updates`, '0.2.0', fakeTransport({release: goodRelease.release, urls: goodRelease.urls, downloads: []}), {keyDir: keys});
        await patched.check(); await patched.install();
        await patched.installFile(`${usbSigned}/${patchName}`);
        assert(patched.state.installed === '0.4.0' && patched.state.trust === 'verified', patched.state.error || 'Signed local patch installs');
        write(`${usbSigned}/SHA256SUMS`, read(`${usbSigned}/SHA256SUMS`).replace(/^./, character => character === 'a' ? 'b' : 'a'));
        const retry = make(`${base}/home-patched/dev-os-updates`, '0.2.0', fakeTransport({release: {}, urls: new Map(), downloads: []}), {keyDir: keys});
        await retry.installFile(`${usbSigned}/${patchName}`); assert(retry.state.error.includes('signature is invalid'), retry.state.error);
        print('PASS: local files: full package, signed patch, sidecar requirements, downgrade and non-package refusal');

        // Failure injection: nothing changes unless everything verified.
        const failRoot = `${base}/home-fail/dev-os-updates`;
        const failRelease = github('0.3.0', [{name: `dev-os-${target}.tar.gz`, path: v1.archive}]);
        const failState: Parameters<typeof fakeTransport>[0] = {release: failRelease.release as unknown, urls: failRelease.urls, downloads: [] as string[], failAfter: `dev-os-${target}.tar.gz`};
        const flaky = make(failRoot, '0.2.0', fakeTransport(failState));
        await flaky.check(); await flaky.install();
        assert(flaky.state.error.includes('Connection lost') && !flaky.state.managed && !GLib.file_test(`${failRoot}/history.json`, GLib.FileTest.EXISTS), 'Interrupted download changes nothing');
        assert(!GLib.file_test(`${failRoot}/install.lock`, GLib.FileTest.EXISTS) && run(['sh', '-c', `ls -A "${failRoot}" "${failRoot}/releases" | grep -c staging || true`]) === '0', 'Lock and staging are cleaned after the failure');
        write(`${failRoot}/.staging-leftover/x`, 'old'); write(`${failRoot}/releases/.staging-halfway/y`, 'old');
        delete failState.failAfter;
        await flaky.check(); await flaky.install();
        assert(flaky.state.installed === '0.3.0' && !GLib.file_test(`${failRoot}/.staging-leftover`, GLib.FileTest.EXISTS) && !GLib.file_test(`${failRoot}/releases/.staging-halfway`, GLib.FileTest.EXISTS), flaky.state.error || 'Leftovers of an interrupted run are removed on the next install');
        // Package whose files do not match its manifest is refused although the archive hash is the advertised one.
        const corrupt = repack(v2.archive, scratch => write(`${scratch}/dev-os/dist/main.js`, '// swapped after the manifest was built\n'), 'corrupt');
        const corruptRelease = github('0.4.0', [{name: `dev-os-${target}.tar.gz`, path: corrupt}]);
        const bad = make(`${base}/home-bad/dev-os-updates`, '0.3.0', fakeTransport({release: corruptRelease.release, urls: corruptRelease.urls, downloads: []}));
        await bad.check(); await bad.install();
        assert(bad.state.error.includes('manifest checksum') && !bad.state.managed, `Manifest mismatch refused: ${bad.state.error}`);
        const needs = pack(base, '0.7.0', {}, {minCompatible: '0.6.5'});
        const needsRelease = github('0.7.0', [{name: `dev-os-${target}.tar.gz`, path: needs.archive}]);
        const old = make(`${base}/home-min/dev-os-updates`, '0.6.0', fakeTransport({release: needsRelease.release, urls: needsRelease.urls, downloads: []}));
        await old.check(); await old.install();
        assert(old.state.error.includes('needs Dev OS 0.6.5') && !old.state.managed, `minCompatible enforced: ${old.state.error}`);
        const space = make(`${base}/home-space/dev-os-updates`, '0.2.0', fakeTransport({release: failRelease.release, urls: failRelease.urls, downloads: []}), {freeBytes: async () => 1024});
        await space.check(); await space.install();
        assert(space.state.error.includes('Not enough free disk space') && space.state.error.includes('not changed') && !space.state.managed, space.state.error);
        print('PASS: interrupted download, leftover staging, manifest mismatch, minCompatible and out-of-space leave the old version intact');

        // Environment: Live USB, offline, rate limit, background check.
        const live = make(`${base}/home-live/dev-os-updates`, '0.3.0', fakeTransport({release: full2.release, urls: full2.urls, downloads: []}), {live: () => true});
        assert(live.state.blocked.startsWith('Live USB is not updated in place') && live.state.message === live.state.blocked, 'Live USB explains itself immediately');
        await live.check(); assert(live.state.release?.version === '0.4.0' && !live.canInstall, 'Live USB can look but not install');
        await live.install(); assert(!live.state.managed, 'Install is a no-op on Live USB');
        await live.installFile(`${usb}/dev-os-${target}.tar.gz`); assert(live.state.error.includes('Live USB') && !live.state.managed, 'Applying a file is refused on Live USB');
        assert(!(await live.checkIfDue(24)), 'No background checks on Live USB');
        const down: UpdateTransport = {async get() { throw new Error('Could not connect'); }, async download() { throw new Error('offline'); }};
        const offlineUpdater = make(`${base}/home-offline/dev-os-updates`, '0.3.0', down);
        await offlineUpdater.check(); assert(offlineUpdater.state.offline && offlineUpdater.state.message.includes('update file') && offlineUpdater.state.error.includes('internet'), 'Offline is explained and points to the update file');
        const limited: UpdateTransport = {async get() { return {status: 403, body: {}, headers: {'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600)}}; }, async download() { throw new Error('no'); }};
        const limitedUpdater = make(`${base}/home-limit/dev-os-updates`, '0.3.0', limited);
        await limitedUpdater.check(); assert(limitedUpdater.state.error.includes('rate limit') && limitedUpdater.state.error.includes('Try again after'), limitedUpdater.state.error);
        let requests = 0;
        const counting: UpdateTransport = {async get(url) { requests++; return {status: 200, body: url.includes('/swaywm/') ? {tag_name: 'v1.8.6', html_url: 'https://github.com/swaywm/swaylock/releases/tag/v1.8.6'} : full2.release}; }, async download() { throw new Error('no'); }};
        const periodic = make(`${base}/home-periodic/dev-os-updates`, '0.3.0', counting);
        assert(await periodic.checkIfDue(24) && !(await periodic.checkIfDue(24)) && requests === 2, `Daily check runs once a day (${requests} requests)`);
        assert(releaseExtras({tag_name: 'v0.4.0', assets: []}, REPO, target, '0.3.0').patch === null, 'No patch asset, no patch');
        print('PASS: Live USB message, offline text, rate-limit reset time and at-most-daily background check');
    } finally { for (const updater of homes) updater.dispose(); removeTree(base); }
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void main().catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) { printerr(String(failed instanceof Error ? failed.stack ?? failed : failed)); System.exit(1); }
print('Update patch tests passed');
