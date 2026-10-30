import {Gtk, GLib, Gio, React, createRoot, removeTree} from '@dev-os/core';
import {PackageManagerCli} from '../src/apps/org.devos.appstore/package-backend.js';
import {RegistryManager, validateRegistryPackage} from '../src/apps/org.devos.appstore/registry-backend.js';
import {registryApps} from '../src/apps/org.devos.appstore/registry.js';
import {AppStoreView} from '../src/apps/org.devos.appstore/view.js';

Gtk.init(null);
const loop = new GLib.MainLoop(null, false), rootPath = GLib.dir_make_tmp('devos-registry-pm-test-XXXXXX');
function assert(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
function write(path: string, value: string) {GLib.file_set_contents(path, value);}
function command(args: string[]) {
    const [, , error, status] = GLib.spawn_sync(null, args, null, GLib.SpawnFlags.SEARCH_PATH, null);
    assert(status === 0, `${args[0]}: ${new TextDecoder().decode(error!)}`);
}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 70, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const widgets = (widget: Gtk.Widget): Gtk.Widget[] => [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];
async function test() {
    const binary = GLib.getenv('DEV_OS_PM');
    assert(binary && GLib.file_test(binary, GLib.FileTest.IS_EXECUTABLE), 'Provide the actual DevOsPM binary in DEV_OS_PM');
    for (const name of ['tools', 'payload', 'payload/bin', 'shims']) GLib.mkdir_with_parents(`${rootPath}/${name}`, 0o700);
    GLib.setenv('DEV_ROOT', `${rootPath}/store`, true);
    GLib.setenv('XDG_DATA_HOME', `${rootPath}/data`, true);
    GLib.setenv('DEV_BIN_DIR', `${rootPath}/shims`, true);
    GLib.setenv('PATH', `${rootPath}/tools:${GLib.getenv('PATH')}`, true);
    // Only transport is stubbed. Archive inspection, PM installation, list, rollback,
    // launcher creation and removal use the actual implementation and real bytes.
    write(`${rootPath}/tools/curl`, '#!/bin/sh\nprintf "%s\\n" "$@" > "$DEV_OS_TEST_CURL_ARGS"\nwhile [ "$#" -gt 0 ]; do case "$1" in --output) out="$2"; shift 2;; *) shift;; esac; done\ncp "$DEV_OS_TEST_ARCHIVE" "$out"\n');
    command(['chmod', '+x', `${rootPath}/tools/curl`]);
    GLib.setenv('DEV_OS_TEST_CURL_ARGS', `${rootPath}/curl-args`, true);
    function archive(version: string) {
        write(`${rootPath}/payload/package.json`, JSON.stringify({kind: 'app', name: 'actual-pm-name', version, fullname: 'Fixture App', bin: {fixture: 'bin/fixture'}}));
        write(`${rootPath}/payload/bin/fixture`, '#!/bin/sh\nprintf "fixture\\n"\n');
        command(['chmod', '+x', `${rootPath}/payload/bin/fixture`]);
        command(['tar', '-czf', `${rootPath}/fixture.dpkx`, '-C', `${rootPath}/payload`, 'package.json', 'bin']);
        GLib.setenv('DEV_OS_TEST_ARCHIVE', `${rootPath}/fixture.dpkx`, true);
    }
    archive('1.0');
    const packages = new PackageManagerCli(), manager = new RegistryManager(packages, 'aarch64', `${rootPath}/bindings.json`);
    const app = registryApps().find(item => item.registry.id === 'vscode')!;
    app.registry.download = {url: 'https://publisher.example/redirect-without-suffix', arch: 'arm64', format: 'dpkx'};
    const prepared = await manager.prepare(app);
    assert(prepared.info.id === 'actual-pm-name' && !(await packages.installed()).length, 'Download reviews actual identity without installing');
    const args = new TextDecoder().decode(GLib.file_get_contents(`${rootPath}/curl-args`)[1]);
    assert(args.includes('--proto\n=https\n') && args.includes('--proto-redir\n=https\n') && args.includes('--max-filesize'), 'HTTPS redirects and size limits are enforced');
    manager.discard(prepared);
    assert(!GLib.file_test(prepared.path, GLib.FileTest.EXISTS), 'Cancel removes staged download');
    let refused = false;
    try {await manager.install(app, prepared, () => {});} catch {refused = true;}
    assert(refused, 'Discarded review cannot install');
    try {validateRegistryPackage({...prepared.info, arch: 'amd64'}, 'aarch64'); refused = false;} catch {refused = true;}
    assert(refused, 'Wrong payload architecture is rejected');
    const first = await manager.install(app, await manager.prepare(app), () => {});
    assert(first.id === 'actual-pm-name' && manager.packageId('vscode') === first.id, 'Actual PM identity is saved instead of guessed from registry ID');
    assert(GLib.file_test(`${rootPath}/data/applications/dev-fixture.desktop`, GLib.FileTest.EXISTS), 'Actual PM creates the launcher');
    archive('2.0');
    const secondReview = await manager.prepare(app);
    assert(secondReview.existing?.version === '1.0', 'Review reports replacement');
    await manager.install(app, secondReview, () => {});
    assert((await packages.installed())[0].previousVersion === '1.0', 'Replacement retains previous version');
    await packages.rollback(first.id);
    assert((await packages.installed())[0].version === '1.0', 'Real PM rollback restores previous version');
    const restored = new RegistryManager(packages, 'aarch64', `${rootPath}/bindings.json`);
    assert(restored.packageId('vscode') === first.id, 'Mapping survives reopening');
    const window = new Gtk.OffscreenWindow(), root = createRoot(window);
    const find = (id: string) => widgets(window).find(item => item.name === id) as Gtk.Button | undefined;
    const click = async (id: string) => {assert(find(id), `Missing ${id}`); find(id)!.clicked(); await wait();};
    const settle = async (predicate: () => boolean) => {for (let count = 0; count < 150 && !predicate(); count++) await wait(); assert(predicate(), `UI operation timed out: ${(widgets(window).find(item => item.name === 'app-store-user-error') as Gtk.Label | undefined)?.get_text() || 'no error shown'}`);};
    try {
        root.render(<AppStoreView controls={{busy: false, async request() {return {available: false, connected: false, catalog: [], installed: []};}}} packages={packages} registry={restored}/>);
        window.show_all(); await wait(); await wait();
        await click('app-store-app-registry:vscode');
        assert(find('app-store-user-uninstall') && !find('app-store-user-install'), 'Installed registry app offers Uninstall');
        await click('app-store-user-uninstall'); await click('app-store-user-cancel');
        assert((await packages.installed()).length === 1, 'Cancel preserves installed package');
        await click('app-store-user-uninstall'); await click('app-store-user-confirm-remove');
        await settle(() => !!find('app-store-user-install'));
        assert(!(await packages.installed()).length, 'Uninstall uses real PM package identity');
        assert(!GLib.file_test(`${rootPath}/data/applications/dev-fixture.desktop`, GLib.FileTest.EXISTS), 'Uninstall removes launcher');
        // Exercise the complete UI with a real xz-compressed ARM64 Debian fixture.
        for (const name of ['deb', 'deb/DEBIAN', 'deb/usr', 'deb/usr/bin']) GLib.mkdir_with_parents(`${rootPath}/${name}`, 0o700);
        command(['chmod', '755', `${rootPath}/deb/DEBIAN`]);
        write(`${rootPath}/deb/DEBIAN/control`, 'Package: actual-pm-name\nVersion: 3.0\nArchitecture: arm64\nMaintainer: Test <test@example.com>\nDescription: Real PM integration fixture\n');
        write(`${rootPath}/deb/usr/bin/fixture`, '#!/bin/sh\nprintf "fixture\\n"\n');
        command(['chmod', '+x', `${rootPath}/deb/usr/bin/fixture`]);
        command(['dpkg-deb', '-Zxz', '--build', `${rootPath}/deb`, `${rootPath}/fixture.deb`]);
        GLib.setenv('DEV_OS_TEST_ARCHIVE', `${rootPath}/fixture.deb`, true);
        await click('app-store-user-install');
        assert(find('app-store-user-download') && !(await packages.installed()).length, 'Install requires source review before downloading');
        await click('app-store-user-download');
        await settle(() => !!find('app-store-user-review'));
        assert(!(await packages.installed()).length, 'Downloading and review must not install');
        await click('app-store-user-confirm-install');
        await settle(() => !!find('app-store-user-uninstall'));
        assert((await packages.installed())[0].id === 'actual-pm-name' && (await packages.installed())[0].version === '3.0', 'UI installs inspected Debian bytes with real PM');
        await click('app-store-user-uninstall'); await click('app-store-user-confirm-remove');
        await settle(() => !!find('app-store-user-install'));
        await click('app-store-back'); await click('app-store-tab-installed');
        assert(!find('app-store-app-registry:vscode'), 'Uninstalled package disappears from Installed');
    } finally {root.unmount(); window.destroy();}
    print('PASS: real DevOsPM download review, dpkx/deb-xz install, replacement, rollback, persisted identity, UI Install/Uninstall/cancel and launcher cleanup');
}
let failure: unknown;
void test().catch(error => {failure = error;}).finally(() => {removeTree(rootPath); loop.quit();});
loop.run(); if (failure) throw failure;
