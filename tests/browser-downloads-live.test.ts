// Integration fixture: DEV_OS_BROWSER_DOWNLOAD_URL serves a slow attachment.
import {Gtk, Gio, GLib} from '@dev-os/core';
import {WebKit2 as WebKit} from '@dev-os/core/webkit';
import {BrowserDownloads} from '../src/apps/org.devos.browser/downloads.js';
Gtk.init(null);
const url = GLib.getenv('DEV_OS_BROWSER_DOWNLOAD_URL');
if (!url) throw new Error('Set DEV_OS_BROWSER_DOWNLOAD_URL to a slow HTTP attachment fixture');
const loop = new GLib.MainLoop(null, false);
const context = new WebKit.WebContext();
const parent = new Gtk.Window({default_width: 700, default_height: 300});
const downloads = new BrowserDownloads(parent, context);
parent.add(downloads.widget); parent.show();
let failure: unknown;
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function until(check: () => boolean, message: string) {
    for (let i = 0; i < 300; i++) {if (check()) return; await wait();}
    throw new Error(`Timed out: ${message}`);
}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const button = (name: string) => widgets(downloads.widget).find(widget => widget.name === name) as Gtk.Button;
const labels = () => widgets(downloads.widget).filter(widget => widget instanceof Gtk.Label).map(widget => (widget as Gtk.Label).label).join(' ');
const chooser = () => Gtk.Window.list_toplevels().find(window => window instanceof Gtk.FileChooserDialog) as Gtk.FileChooserDialog | undefined;
async function run() {
    const directory = GLib.dir_make_tmp('devos-download-test-XXXXXX'), path = `${directory}/saved.bin`;
    try {
        const first = context.download_uri(url!);
        await until(() => !!button('browser-download-save')?.sensitive, 'Save decision');
        if (first.get_destination()) throw new Error('Download assigned destination before Save');
        if (!downloads.widget.visible) throw new Error('Download shelf is hidden');
        button('browser-download-close').clicked();
        if (downloads.widget.visible) throw new Error('Closing pending download did not hide empty shelf');
        context.download_uri(url!);
        await until(() => !!button('browser-download-save')?.sensitive, 'second decision');
        button('browser-download-save').clicked();
        await until(() => !!chooser(), 'save dialog'); chooser()!.response(Gtk.ResponseType.CANCEL);
        if (!button('browser-download-save').visible) throw new Error('Cancelling chooser lost Save action');
        button('browser-download-save').clicked();
        await until(() => !!chooser(), 'reopen save dialog');
        chooser()!.set_current_folder(directory); chooser()!.set_current_name('saved.bin');
        await wait(); chooser()!.response(Gtk.ResponseType.ACCEPT);
        await until(() => /(?:[1-9]|[1-8][0-9])%/.test(labels()), 'intermediate percentage');
        if (Gio.File.new_for_path(path).query_exists(null)) throw new Error('Partial transfer exposed final file');
        downloads.button.clicked(); downloads.button.clicked();
        await until(() => labels().includes('100% · Complete'), 'completed download');
        const [ok, data] = GLib.file_get_contents(path);
        if (!ok || data.length !== 2 * 1024 * 1024 || data.some(byte => byte !== 65)) throw new Error('Saved bytes differ');
        button('browser-download-close').clicked();
        if (GLib.file_test(path, GLib.FileTest.EXISTS) !== true) throw new Error('Close deleted completed file');
        context.download_uri(url!);
        await until(() => !!button('browser-download-save')?.sensitive, 'cleanup decision');
        button('browser-download-save').clicked();
        await until(() => !!chooser(), 'cancel transfer dialog');
        chooser()!.set_current_folder(directory); chooser()!.set_current_name('cancelled.bin');
        await wait(); chooser()!.response(Gtk.ResponseType.ACCEPT);
        await until(() => /(?:[1-9]|[1-8][0-9])%/.test(labels()), 'cancel transfer progress');
        button('browser-download-close').clicked();
        await wait();
        const enumerator = Gio.File.new_for_path(directory).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        try {let file; while ((file = enumerator.next_file(null))) {if (file.get_name() !== 'saved.bin') throw new Error('Cancelled transfer left a partial or final file');}} finally {enumerator.close(null);}
        print('PASS: Save/Close, cancelled chooser, live percentage, exact saved bytes and completed-file retention');
    } finally {downloads.dispose(); parent.destroy(); for (const name of ['saved.bin']) {try {Gio.File.new_for_path(`${directory}/${name}`).delete(null);} catch {}} Gio.File.new_for_path(directory).delete(null);}
}
const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {failure = new Error('Download test timeout'); loop.quit(); return GLib.SOURCE_REMOVE;});
void run().catch(error => {failure = error;}).finally(() => loop.quit());
loop.run(); GLib.source_remove(timeout); if (failure) throw failure;
