import {
    Gio, GLib, type UIContext
} from '@dev-os/core';
import System from 'system';
import {ROOT} from '@dev-os/config';
import {ExtensionManager, ExtensionStore, type StoreTransport, loadUserExtensions} from '@dev-os/extensions';

import {repoInput, manifestForRelease, validateExtensionArchive} from '@dev-os/extensions/store-protocol';

import {removeTree} from '@dev-os/updates';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function fails(callback: () => unknown) { let failed = false; try { callback(); } catch { failed = true; } assert(failed, 'Expected rejection'); }
function command(args: string[]) {
    const process = Gio.Subprocess.new(args, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, output, error] = process.communicate_utf8(null, null); assert(process.get_successful(), error || 'Command failed'); return output!.trimEnd();
}
function write(path: string, value: string) { GLib.mkdir_with_parents(Gio.File.new_for_path(path).get_parent()!.get_path()!, 0o700); GLib.file_set_contents(path, value); }
function fixture(base: string, version: string) {
    const directory = `${base}/fixture-${version}`;
    const manifest = {id: 'org.example.storetest', name: 'Store test', description: 'A real test package', version, apiVersion: 1,
        kind: 'ui', system: false, entry: 'org.example.storetest.js', order: 100, settingsVersion: 1, enabledByDefault: true,
        settings: [{id: 'general', title: 'General', fields: [{key: 'enabledBadge', title: 'Badge', type: 'boolean', default: true}]}]};
    write(`${directory}/extension/extension.json`, JSON.stringify(manifest));
    write(`${directory}/extension/dist/${manifest.entry}`, `export default {id:'${manifest.id}', activate(context){context.registerCommand('store-${version}',()=>{});return ()=>{};}};`);
    const archive = `${base}/${version}.tar.gz`; command(['tar', '-czf', archive, '-C', directory, 'extension']);
    const size = Gio.File.new_for_path(archive).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
    const sha = command(['sha256sum', '--', archive]).split(/\s+/)[0];
    const release = {tag_name: `v${version}`, draft: false, prerelease: false, assets: [
        {name: 'dev-os-extension.tar.gz', state: 'uploaded', size, digest: `sha256:${sha}`, browser_download_url: `https://github.com/example/tools/releases/download/v${version}/dev-os-extension.tar.gz`},
        {name: 'extension.json', state: 'uploaded', size: 600, digest: `sha256:${'1'.repeat(64)}`, browser_download_url: `https://github.com/example/tools/releases/download/v${version}/extension.json`},
    ]};
    return {manifest, archive, release};
}
async function main() {
    const base = GLib.dir_make_tmp('dev-os-store-test-XXXXXX');
    const paths = {bundled: `${ROOT}/extensions`, user: `${base}/extensions`, preferences: `${base}/preferences`};
    const manager = new ExtensionManager(paths);
    let selected = fixture(base, '1.0.0'); let downloads = 0;
    const transport: StoreTransport = {
        async get(url) { return {status: 200, body: url.endsWith('/extension.json') ? selected.manifest : selected.release}; },
        async download(_release, path) { downloads++; Gio.File.new_for_path(selected.archive).copy(Gio.File.new_for_path(path), Gio.FileCopyFlags.NONE, null, null); },
    };
    const options = {root: `${base}/store`, packages: paths.user, transport};
    const store = new ExtensionStore(manager, options);
    try {
        assert(repoInput('https://github.com/example/tools.git/') === 'example/tools', 'GitHub URLs normalize to owner/repo');
        fails(() => repoInput('https://evil.invalid/example/tools')); fails(() => manifestForRelease({...selected.manifest, system: true}, '1.0.0', []));
        fails(() => manifestForRelease(selected.manifest, '2.0.0', [])); fails(() => manifestForRelease(selected.manifest, '1.0.0', [selected.manifest.id]));
        const names = command(['tar', '-tzf', selected.archive]), details = command(['tar', '-tvzf', selected.archive, '--numeric-owner']);
        validateExtensionArchive(names, details, manifestForRelease(selected.manifest, '1.0.0', []));
        fails(() => validateExtensionArchive(names.replace('extension/extension.json', 'extension/../outside'), details, manifestForRelease(selected.manifest, '1.0.0', [])));
        fails(() => validateExtensionArchive(names, details.replace(/^-/m, 'l'), manifestForRelease(selected.manifest, '1.0.0', [])));
        print('PASS: Store repository URLs, stable versions, base protection and safe archive validation');
        await store.connect('https://github.com/example/tools');
        assert(store.items.length === 1 && store.canInstall(store.items[0]) && downloads === 0, store.error || 'Connect checks metadata without installing');
        await store.install('example/tools');
        assert(store.items[0].installed?.version === '1.0.0' && !store.busy, store.error || 'First release installed');
        const immutable = manager.packagePath(selected.manifest.id);
        assert(immutable.startsWith(`${base}/store/releases/`), 'User loader resolves an immutable release');
        manager.update(selected.manifest.id, true, {enabledBadge: false});
        const first = await loadUserExtensions(manager); const commands: string[] = [];
        first.find(def => def.id === selected.manifest.id)!.activate({registerCommand: (name: string) => { commands.push(name); return () => {}; }} as unknown as UIContext);
        assert(commands.includes('store-1.0.0'), 'Downloaded entry activates');
        selected = fixture(base, '2.0.0'); await store.check(); await store.install('example/tools');
        assert(store.items[0].installed?.version === '2.0.0' && store.items[0].installed?.previous?.version === '1.0.0', store.error || 'New release installed with rollback');
        assert(manager.get(selected.manifest.id).state.values.enabledBadge === false, 'Settings preserved across updates');
        assert(GLib.file_test(`${immutable}/dist/${selected.manifest.entry}`, GLib.FileTest.EXISTS), 'Previously loaded code is preserved');
        const second = await loadUserExtensions(manager);
        second.find(def => def.id === selected.manifest.id)!.activate({registerCommand: (name: string) => { commands.push(name); return () => {}; }} as unknown as UIContext);
        assert(commands.includes('store-2.0.0'), 'New session loader imports the updated immutable URI');
        await store.rollback('example/tools'); assert(store.items[0].installed?.version === '1.0.0', store.error || 'Rollback selects previous version');
        await store.check(); await store.install('example/tools'); assert(store.items[0].installed?.version === '2.0.0' && !store.busy, store.error || 'Cached update can be selected after rollback');
        print('PASS: Store installs real tar packages, loads user UI, preserves preferences and supports update/rollback');
        selected = fixture(base, '3.0.0'); selected.release.assets[0].digest = `sha256:${'0'.repeat(64)}`;
        await store.check(); await store.install('example/tools');
        assert(store.error.includes('SHA-256') && store.items[0].installed?.version === '2.0.0' && !store.busy, 'Corrupt package preserves selected version');
        assert(!GLib.file_test(`${base}/store/install.lock`, GLib.FileTest.EXISTS), 'Failed installer releases its lock');
        const persisted = new ExtensionStore(manager, options); assert(persisted.items[0].installed?.version === '2.0.0', 'Connected repositories and selected versions survive reopening'); persisted.dispose();
        print('PASS: Store checksum failure keeps installed code and persistent repository connections');
        manager.update(selected.manifest.id, false, {enabledBadge: false});
        assert(!(await loadUserExtensions(manager)).some(def => def.id === selected.manifest.id), 'Disabled extensions do not load');
        await store.uninstall('example/tools'); assert(!store.items[0].installed && GLib.file_test(`${paths.preferences}/${selected.manifest.id}.json`, GLib.FileTest.EXISTS), store.error || 'Uninstall preserves preferences');
        store.disconnect('example/tools'); assert(store.items.length === 0, 'Disconnect persists removal');
        print('PASS: Store disables, uninstalls and disconnects without deleting preferences');
        const packaged = GLib.getenv('DEV_OS_STORE_TEST_PACKAGE');
        if (packaged) {
            const manifest = JSON.parse(command(['tar', '-xOf', packaged, 'extension/extension.json']));
            const size = Gio.File.new_for_path(packaged).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
            const sha = command(['sha256sum', '--', packaged]).split(/\s+/)[0];
            const assets = ['dev-os-extension.tar.gz', 'extension.json'].map(name => ({name, state: 'uploaded', size: name.endsWith('json') ? 2048 : size,
                digest: `sha256:${sha}`, browser_download_url: `https://github.com/example/sdk/releases/download/v${manifest.version}/${name}`}));
            const sdkManager = new ExtensionManager({...paths, user: `${base}/sdk-packages`, preferences: `${base}/sdk-preferences`});
            const sdk = new ExtensionStore(sdkManager, {root: `${base}/sdk-store`, packages: `${base}/sdk-packages`, transport: {
                async get(url) { return {status: 200, body: url.endsWith('extension.json') ? manifest : {tag_name: `v${manifest.version}`, assets}}; },
                async download(_release, target) { Gio.File.new_for_path(packaged).copy(Gio.File.new_for_path(target), Gio.FileCopyFlags.NONE, null, null); },
            }});
            try {
                await sdk.connect('example/sdk'); await sdk.install('example/sdk');
                assert(sdk.items[0].installed?.version === manifest.version, sdk.error || 'Packager artifact installed');
                GLib.setenv('DEV_OS_ROOT', ROOT, true);
                const definitions = await loadUserExtensions(sdkManager); let registered = '';
                definitions.find(def => def.id === manifest.id)!.activate({registerSettingsPage(id: string) { registered = id; return () => {}; }} as unknown as UIContext);
                assert(registered === manifest.id, 'Packaged TSX entry and shared React runtime import correctly');
                print('PASS: real extension packager artifact installs and its React GTK entry loads with the shared desktop runtime');
            } finally { sdk.dispose(); sdkManager.dispose(); }
        }
    } finally { store.dispose(); manager.dispose(); removeTree(base); }
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void main().catch(error => { failed = error; }).finally(() => loop.quit()); loop.run();
if (failed) { printerr(String(failed)); System.exit(1); }
print('Extension Store integration tests passed');

