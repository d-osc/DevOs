import {testTheme} from './theme-helper.js';
import {Gtk, Gdk, GLib, React, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {PackageInstallView} from '../src/apps/org.devos.appstore/package-view.js';
import {AppStoreView} from '../src/apps/org.devos.appstore/view.js';
import type {PackageControls, InstalledPackage} from '../src/apps/org.devos.appstore/package-backend.js';
import type {PackageInfo} from '../src/apps/org.devos.appstore/package-file.js';
import type {StoreControls} from '../src/apps/org.devos.appstore/backend.js';
Gtk.init(null);
const loop = new GLib.MainLoop(null, false);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const widgets = (widget: Gtk.Widget): Gtk.Widget[] => [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
const info = (extra: Partial<PackageInfo> = {}): PackageInfo => ({kind: 'dpk', path: '/home/u/hello.dpk', fileName: 'hello.dpk', size: 2048, id: 'hello', name: 'Hello', version: '1.0.0', fileCount: 3, totalBytes: 5000,
    dependencies: [], commands: ['hello'], launchers: [], scripts: [], warnings: [], blockers: [], signature: 'Not signed. Only install files you trust.', details: '', ...extra});
async function test() {
    const installed: InstalledPackage[] = []; const calls: string[] = []; let fail = false, resolveInstall: (() => void) | undefined;
    const controls: PackageControls = {busy: false,
        async inspect(path) {
            calls.push(`inspect ${path}`);
            if (path.includes('evil')) return info({fileName: 'evil.dpk', blockers: ['Unsafe path "../x" (parent-directory (..) segment); the package manager will refuse this archive.']});
            if (path.includes('deb')) return info({kind: 'deb', fileName: 'x.deb', id: 'x', name: 'x', warnings: ['Built for Debian/Ubuntu: it may not run here.', 'Maintainer scripts (postinst) will NOT be executed.'], dependencies: ['libc6', 'bash'], arch: 'arm64'});
            return info();
        },
        async installed() {return [...installed];},
        install(path, onStage) {
            calls.push(`install ${path}`); onStage('Extracting files...');
            if (fail) return Promise.reject(new Error('Archive has too many entries'));
            return new Promise(resolve => {resolveInstall = () => {
                installed.push({id: 'hello', version: '1.0.0', kind: 'app', files: 3, bytes: 5000, commands: ['hello'], description: '', title: 'Hello', previousVersion: '0.9.0'});
                resolve({id: 'hello', version: '1.0.0', path: '/p', commands: ['hello'], extension: false});
            };});
        },
        async remove(id) {calls.push(`remove ${id}`); installed.splice(0);}, async rollback(id) {calls.push(`rollback ${id}`); return '0.9.0';}};
    const window = new Gtk.OffscreenWindow(); window.name = 'package-install'; window.set_size_request(760, 760); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T | undefined;
    const label = (id: string) => (find<Gtk.Label>(id)?.get_text() ?? '');
    const click = async (id: string) => {const widget = find<Gtk.Button>(id); if (!widget) throw new Error(`Missing ${id}`); widget.clicked(); await wait();};
    let closed = 0, launched = '';
    const view = (paths: string[]) => <PackageInstallView key={paths.join()} controls={controls} paths={paths} launch={command => {launched = command; return null;}} onClose={() => {closed++;}}/>;
    try {
        root.render(view(['/home/u/hello.dpk', '/home/u/b.deb'])); window.show_all(); await wait(); await wait();
        assert(label('pkg-title') === 'Install Hello?' && label('pkg-version') === '1.0.0' && label('pkg-files').startsWith('3') && label('pkg-trust').includes('Not signed') && label('pkg-location').includes('your user only'), 'review shows package details, trust and install location');
        assert(label('pkg-file').includes('Package 1 of 2'), 'queue position shown');
        assert(!calls.some(call => call.startsWith('install')), 'nothing is installed before confirmation');
        const screenshot = GLib.getenv('DEV_OS_PACKAGE_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        await click('pkg-cancel'); assert(closed === 1 && !calls.some(call => call.startsWith('install')), 'Cancel closes without installing');
        await click('pkg-install'); assert(label('pkg-progress').includes('Extracting files') && find('pkg-cancel')?.sensitive === false, 'progress is shown and cancel is disabled while installing');
        resolveInstall!(); await wait(); await wait();
        assert(label('pkg-result').startsWith('hello 1.0.0 installed') && find('pkg-open') && find('pkg-next'), 'result shows Open app and Next package');
        await click('pkg-open'); assert(launched === 'hello', 'Open app launches the first exported command');
        await click('pkg-next'); await wait();
        assert(label('pkg-kind').includes('Debian') && label('pkg-warning-1').includes('NOT be executed') && label('pkg-dependencies').includes('not installed automatically') && label('pkg-arch') === 'arm64', 'second queued package: deb warnings and dependencies');
        root.render(view(['/home/u/evil.dpk'])); await wait(); await wait();
        assert(label('pkg-blocker-0').includes('Unsafe path') && find<Gtk.Button>('pkg-install')!.sensitive === false, 'blocked packages cannot be installed');
        root.render(view(['/home/u/again.dpk'])); await wait(); await wait();
        assert(label('pkg-existing').includes('replaced') && find<Gtk.Button>('pkg-install')!.get_label() === 'Replace and install', 'an installed package is marked for replacement');
        fail = true; await click('pkg-install'); await wait();
        assert(label('pkg-error').includes('too many entries') && find('pkg-close') && !find('pkg-install'), 'failure shows the error and Close');
        fail = false;
        const store: StoreControls = {busy: false, async request() {return {available: true, connected: true, installed: [], catalog: []};}};
        root.render(<AppStoreView controls={store} packages={controls} launchCommand={() => null}/>); await wait(); await wait();
        await click('app-store-tab-packages'); await wait();
        assert(label('pkg-item-hello').includes('Hello') && find('pkg-rollback-hello') && find('pkg-remove-hello'), 'App Store lists installed packages with rollback and remove');
        await click('pkg-remove-hello'); await click('pkg-remove-cancel-hello'); assert(!calls.includes('remove hello'), 'removal needs confirmation and Cancel keeps the package');
        await click('pkg-rollback-hello'); assert(calls.includes('rollback hello'), 'rollback');
        await click('pkg-remove-hello'); await click('pkg-remove-confirm-hello'); await wait(); assert(calls.includes('remove hello') && find('pkg-list-empty'), 'confirmed removal empties the list');
        root.render(<AppStoreView controls={store}/>); await wait(); await wait(); assert(!find('app-store-tab-packages'), 'Packages tab only appears when package controls exist');
    } finally {root.unmount(); window.destroy(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css);}
    print('PASS: install page review, trust/warnings, blockers, progress, result, failure, queue; App Store package list with remove/rollback');
}
let failure: unknown; void test().catch(error => {failure = error;}).finally(() => loop.quit()); loop.run(); if (failure) throw failure;
