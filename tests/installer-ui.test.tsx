import {testTheme} from './theme-helper.js';
import {Gtk, Gdk, GLib, React, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {InstallerWizard} from '../extensions/org.devos.installer/extension.js';
import {parseInstallLine, type InstallDisk, type InstallerControls, type InstallOptions, type InstallEvent} from '../extensions/org.devos.installer/installer.js';
Gtk.init(null);
const loop = new GLib.MainLoop(null, false);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const widgets = (widget: Gtk.Widget): Gtk.Widget[] => [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const nvme: InstallDisk = {name: 'nvme0n1', path: '/dev/nvme0n1', size: 512 * 1073741824, model: 'Test NVMe', transport: 'nvme', removable: false, contents: 'ntfs,vfat'};
const spare: InstallDisk = {name: 'vda', path: '/dev/vda', size: 64 * 1073741824, model: '', transport: 'virtio', removable: false, contents: ''};

async function test() {
    // Parsing of the helper's progress protocol; tool chatter is ignored.
    assert(JSON.stringify(parseInstallLine('STEP 4/10 Copying Dev OS')) === JSON.stringify({kind: 'step', step: 4, total: 10, message: 'Copying Dev OS'}), 'Step line');
    assert(parseInstallLine('ERROR Disk is busy')?.kind === 'error' && parseInstallLine('DONE ok')?.kind === 'done' && parseInstallLine('mkfs.ext4: noise') === null, 'Error, done and noise');

    let live = false, disks: InstallDisk[] = [nvme, spare], rebooted = 0, installed: InstallOptions | null = null, outcome: 'done' | 'error' = 'done', listed = 0;
    const controls: InstallerControls = {
        available: () => live,
        async disks() { listed++; return disks; },
        async install(options, report) {
            installed = options;
            const send = async (event: InstallEvent) => { report(event); await wait(); };
            await send({kind: 'step', step: 1, total: 10, message: 'Partitioning'});
            await send({kind: 'step', step: 5, total: 10, message: 'Writing disk and host configuration'});
            await send(outcome === 'done' ? {kind: 'done', message: 'Installed. Remove the USB drive.'} : {kind: 'error', message: 'Copying the system failed'});
        },
        reboot() { rebooted++; }, destroy() {},
    };
    const window = new Gtk.OffscreenWindow(); window.name = 'installer'; window.set_size_request(1000, 700); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme()))); Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = (name: string) => widgets(window).find(widget => widget.name === name);
    const need = (name: string) => { const widget = find(name); assert(widget, `Missing ${name}`); return widget; };
    const click = async (name: string) => { (need(name) as Gtk.Button).clicked(); await wait(); await wait(); };
    const type = async (name: string, text: string) => { (need(name) as Gtk.Entry).set_text(text); await wait(); };
    const enabled = (name: string) => need(name).get_sensitive();
    const labelText = (name: string) => (need(name) as Gtk.Label).get_label();
    const show = async (element: React.ReactElement) => { root.render(element); window.show_all(); await wait(); await wait(); };
    try {
        // Outside the Live USB nothing can be started.
        await show(<InstallerWizard controls={controls} />);
        assert(find('installer-unavailable') && !find('installer-start'), 'The installer is refused outside the Live session');
        assert(listed === 0, 'No disk inventory is read outside the Live session');

        live = true; await show(<InstallerWizard controls={controls} key="live" />);
        assert(find('installer-start') && !find('installer-unavailable'), 'Welcome page');
        const welcomeShot = GLib.getenv('DEV_OS_INSTALLER_SCREENSHOT');
        if (welcomeShot) window.get_pixbuf()!.savev(welcomeShot.replace('.png', '-welcome.png'), 'png', [], []);
        await click('installer-start');
        assert(find('installer-disk-nvme0n1') && find('installer-disk-vda'), 'Disks are listed');
        assert(!enabled('installer-next'), 'No disk is preselected, so the user must choose one');
        await click('installer-disk-nvme0n1');
        assert(enabled('installer-next'), 'Choosing a disk enables Next');
        await click('installer-next');

        // Account page validation.
        assert(!enabled('installer-next'), 'Next is disabled until the account is valid');
        await type('installer-username', 'Bad Name'); await type('installer-password', 'pw12'); await type('installer-confirm', 'pw12');
        assert(find('installer-form-error') && !enabled('installer-next'), 'An invalid user name is explained');
        await type('installer-username', 'dev'); await type('installer-confirm', 'other');
        assert(labelText('installer-form-error').includes('do not match') && !enabled('installer-next'), 'Mismatched passwords are explained');
        await type('installer-password', 'abc');
        assert(labelText('installer-form-error').includes('at least 4'), 'A short password is explained');
        await type('installer-password', 'pw12'); await type('installer-confirm', 'pw12'); await type('installer-hostname', 'my laptop');
        assert(!enabled('installer-next'), 'An invalid computer name blocks Next');
        await type('installer-hostname', 'laptop');
        assert(enabled('installer-next') && !find('installer-form-error'), 'A valid account enables Next');
        await click('installer-next');

        // Confirmation requires typing the exact disk path.
        assert(labelText('installer-warning').includes('/dev/nvme0n1') && labelText('installer-warning').includes('ntfs,vfat'), 'The warning names the disk and its data');
        assert(!enabled('installer-erase'), 'Erase starts disabled');
        await type('installer-confirm-disk', '/dev/vda');
        assert(!enabled('installer-erase'), 'A different disk path does not confirm');
        await type('installer-confirm-disk', '/dev/nvme0n1');
        assert(enabled('installer-erase'), 'The exact path confirms');
        assert(installed === null, 'Nothing starts before the final click');
        await click('installer-erase');
        for (let i = 0; i < 8 && !find('installer-restart'); i++) await wait();
        const run = installed as InstallOptions | null;
        assert(run && run.disk.path === '/dev/nvme0n1' && run.disk.size === nvme.size && run.username === 'dev' && run.hostname === 'laptop' && run.password === 'pw12', 'The chosen options reach the installer');
        assert(find('installer-restart'), 'The finished page offers a restart');
        await click('installer-restart'); assert(rebooted === 1, 'Restart is requested once');

        // A failed run explains itself and allows a retry from the disk choice.
        outcome = 'error'; installed = null; await show(<InstallerWizard controls={controls} key="failure" />);
        await click('installer-start'); await click('installer-disk-vda'); await click('installer-next');
        await type('installer-username', 'dev'); await type('installer-password', 'pw12'); await type('installer-confirm', 'pw12'); await click('installer-next');
        await type('installer-confirm-disk', '/dev/vda'); await click('installer-erase');
        for (let i = 0; i < 8 && !find('installer-failure'); i++) await wait();
        assert(find('installer-failure') && labelText('installer-failure').includes('Copying the system failed'), 'The failure message is shown');
        assert(!find('installer-restart'), 'A failed install does not offer a restart');
        await click('installer-retry'); assert(find('installer-disk-vda'), 'Retry returns to the disk choice');

        // No suitable disk.
        disks = []; await show(<InstallerWizard controls={controls} key="empty" />); await click('installer-start'); await wait();
        assert(find('installer-disks-empty') && !enabled('installer-next'), 'An empty inventory is explained and blocks Next');
        const shot = GLib.getenv('DEV_OS_INSTALLER_SCREENSHOT'); if (shot) window.get_pixbuf()!.savev(shot, 'png', [], []);
    } finally { root.unmount(); window.destroy(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css); }
    print('PASS: Installer wizard refuses outside Live, validates account, requires the exact disk path, reports progress/failure and restarts');
}
let failure: unknown; void test().catch(error => {failure = error;}).finally(() => loop.quit()); loop.run(); if (failure) throw failure;
