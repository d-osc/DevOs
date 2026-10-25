import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, Gio, GLib, Box, createRoot, removeTree} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {Updates, type UpdateTransport} from '@dev-os/updates';
import {patchAssetName} from '@dev-os/updates/manifest';
import {UpdatesView} from '../extensions/org.devos.updates/view.js';

Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 170, () => { resolve(); return GLib.SOURCE_REMOVE; }));
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function widgets(widget: Gtk.Widget): Gtk.Widget[] { return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])]; }
const machine = (() => { const child = Gio.Subprocess.new(['uname', '-m'], Gio.SubprocessFlags.STDOUT_PIPE); const [, out] = child.communicate_utf8(null, null); return out!.trim() === 'x86_64' ? 'linux-x64' : 'linux-arm64'; })();
const swaylock = {tag_name: 'v1.8.6', html_url: 'https://github.com/swaywm/swaylock/releases/tag/v1.8.6'};
function releaseBody(version: string, withPatch: string | null) {
    const asset = (name: string, size: number) => ({name, state: 'uploaded', size, digest: `sha256:${'a'.repeat(64)}`,
        browser_download_url: `https://github.com/d-osc/DevOs/releases/download/v${version}/${name}`});
    return {tag_name: `v${version}`, draft: false, prerelease: false, body: `## ${version}\n- Faster settings`,
        assets: [asset(`dev-os-${machine}.tar.gz`, 40 * 1048576), ...(withPatch ? [asset(patchAssetName(withPatch, version, machine), 2 * 1048576)] : [])]};
}
function installedFixture(directory: string, version: string, key: string) {
    GLib.mkdir_with_parents(`${directory}/releases/${key}`, 0o700);
    GLib.file_set_contents(`${directory}/releases/${key}/release.json`, JSON.stringify({format: 1, version, platform: machine}));
    GLib.file_set_contents(`${directory}/history.json`, JSON.stringify({current: {key, version, repository: 'd-osc/DevOs', platform: machine}, previous: null}));
}

async function verify() {
    const temporary = GLib.dir_make_tmp('dev-os-updates-ui-XXXXXX');
    const window = new Gtk.OffscreenWindow(); window.set_size_request(900, 900); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T | undefined;
    const text = (id: string) => (find<Gtk.Label>(id)?.get_text() ?? '');
    const click = (id: string) => (find<Gtk.Button>(id) as Gtk.Button).emit('clicked');
    const updaters: Updates[] = [];
    const make = (root: string, transport: UpdateTransport | undefined, live: boolean, running: string) => {
        const updater = new Updates({repository: () => 'd-osc/DevOs', root, running, transport, live: () => live, keyDir: '/nonexistent'});
        updaters.push(updater); return updater;
    };
    const github = (body: unknown): UpdateTransport => ({async get(url) { return {status: 200, body: url.includes('/swaywm/') ? swaylock : body}; }, async download() { throw new Error('never'); }});
    try {
        // A newer release is available: version, size, checksum/signature state and notes are visible.
        let updater = make(`${temporary}/normal`, github(releaseBody('0.4.0', null)), false, '0.3.0');
        root.render(<UpdatesView key={updater.root} updater={updater} preferences={preferences} />); window.show_all(); await wait();
        assert(!find('updates-install') && !find('updates-live') && !find('updates-progress'), 'Nothing to install before checking');
        click('updates-check'); await wait(); await wait();
        assert(!!find('updates-install') && text('updates-release-info').includes('40.0 MB') && text('updates-release-info').includes('SHA-256 verified'), 'Release size and checksum policy are shown');
        assert(widgets(window).some(widget => widget instanceof Gtk.Label && widget.get_text().includes('Faster settings')), 'Release notes are shown');
        assert(!!find('updates-versions') && widgets(find('updates-versions')!).some(widget => widget instanceof Gtk.Label && widget.get_text() === '0.3.0'), 'Installed versions are listed');
        // Local update file: needs a second click to confirm, then hands the path to the updater.
        let installed = ''; updater.installFile = async path => { installed = path; };
        assert(!find<Gtk.Button>('updates-install-file')!.sensitive, 'Apply is disabled until a file is chosen');
        find<Gtk.Entry>('updates-file')!.set_text('/media/usb/dev-os-linux-arm64.tar.gz'); await wait();
        click('updates-install-file'); assert(!installed && !!find('updates-file-warning'), 'First click warns about trusting the file');
        click('updates-install-file'); assert(installed === '/media/usb/dev-os-linux-arm64.tar.gz', 'Second click applies the chosen file');
        // The background check is a switch that defaults to off and is persisted.
        const periodic = find<Gtk.Switch>('updates-periodic')!;
        assert(!periodic.active && preferences.get('org.devos.updates').state.values.periodicCheck === false, 'Daily background check is off by default');
        periodic.set_active(true); await wait();
        assert(preferences.get('org.devos.updates').state.values.periodicCheck === true, 'The choice is saved');

        // Patch available for the installed version: the smaller download is announced.
        root.render(<Box />); await wait();
        installedFixture(`${temporary}/patch`, '0.3.0', '0.3.0-aaaaaaaaaaaa');
        updater = make(`${temporary}/patch`, github(releaseBody('0.4.0', '0.3.0')), false, '0.3.0');
        root.render(<UpdatesView key={updater.root} updater={updater} preferences={preferences} />); await wait();
        click('updates-check'); await wait(); await wait();
        assert(text('updates-release-info').includes('patch from 0.3.0 2.0 MB') && text('updates-release-info').includes('full package 40.0 MB'), `Patch size is compared with the full package: ${text('updates-release-info')}`);

        // Live USB: explained, no install possible, no file apply.
        updater = make(`${temporary}/live`, github(releaseBody('0.4.0', null)), true, '0.3.0');
        root.render(<UpdatesView key={updater.root} updater={updater} preferences={preferences} />); await wait();
        assert(text('updates-live').startsWith('Live USB is not updated in place') && text('updates-status').startsWith('Live USB is not updated in place'), `Live USB page explains that a newer image must be written: [${text('updates-live')}] [${text('updates-status')}] ${updater.state.blocked}`);
        click('updates-check'); await wait(); await wait();
        assert(!find('updates-install') && !find<Gtk.Button>('updates-install-file')!.sensitive && !find<Gtk.Button>('updates-browse')!.sensitive, 'Live USB cannot install or apply files');
        assert(text('updates-status').includes('Dev OS 0.4.0 is available'), 'Live USB can still show that a newer release exists');

        // Offline: actionable message.
        updater = make(`${temporary}/offline`, {async get() { throw new Error('Could not connect'); }, async download() { throw new Error('never'); }}, false, '0.3.0');
        root.render(<UpdatesView key={updater.root} updater={updater} preferences={preferences} />); await wait();
        click('updates-check'); await wait(); await wait();
        assert(text('updates-error').includes('internet') && text('updates-status').includes('update file') && !!find('updates-install-file'), 'Offline points to applying an update file');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);

        // Installed but not running: restart now / later.
        installedFixture(`${temporary}/ready`, '0.5.0', '0.5.0-bbbbbbbbbbbb');
        const pending = make(`${temporary}/ready`, undefined, false, '0.4.0');
        root.render(<UpdatesView key={pending.root} updater={pending} preferences={preferences} useVersion={async () => {}} />); await wait();
        assert(find<Gtk.Button>('updates-use-version')!.label === 'Restart shell now' && !!find('updates-restart-later'), 'Restart shell now / Restart later are offered');
        click('updates-restart-later'); await wait();
        assert(!find('updates-use-version'), 'Restart later hides the prompt without changing anything');

        // System update: pending restart shows Restart now / later, rollback and the helper's reason on Live USB.
        const helperScript = `${temporary}/helper.sh`;
        GLib.file_set_contents(helperScript, ['#!/bin/sh', `echo '{"ok":true,"version":"0.3.0","kernel":"6.17.0","machine":"aarch64","live":false,"efi":true,"esp":true,"safeBoot":true,"pending":"0.4.0","pendingKernel":"6.18.0","canRollback":false,"lastError":"","signed":false}'`, ''].join(String.fromCharCode(10)));
        let restarted = 0;
        const system = new Updates({repository: () => 'd-osc/DevOs', root: `${temporary}/system`, running: '0.3.0', live: () => false, keyDir: '/nonexistent',
            systemCommand: ['sh', helperScript], reboot: async () => { restarted++; }});
        updaters.push(system);
        root.render(<UpdatesView key={system.root} updater={system} preferences={preferences} />); await wait(); await wait();
        assert(text('updates-system-pending').includes('0.4.0') && !!find('updates-system-cancel'), 'A pending system update is shown with a cancel button');
        assert(!!find('updates-restart-card') && !find('updates-install-system'), 'Restart card is shown instead of an install button');
        click('updates-restart-computer'); await wait(); assert(restarted === 1, 'Restart now restarts the computer');
        click('updates-restart-computer-later'); await wait(); assert(!find('updates-restart-card'), 'Restart later hides the card');
    } finally { root.unmount(); window.destroy(); for (const updater of updaters) updater.dispose(); preferences.dispose(); removeTree(temporary); }
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => { failed = error; }).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: Updates page: release details, patch size, local file, background check, Live USB, offline and restart prompt');
