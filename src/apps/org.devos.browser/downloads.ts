import {BrowserData} from './data.js';
import {Gtk, Gio, GLib} from '@dev-os/core';
import {WebKit2 as WebKit} from '@dev-os/core/webkit';

/** Wait for Save; use a partial file so cancelling never truncates an existing file. */
export class BrowserDownloads {
    readonly widget = new Gtk.ScrolledWindow({no_show_all: true, propagate_natural_height: true, max_content_height: 180,
        hscrollbar_policy: Gtk.PolicyType.NEVER, vscrollbar_policy: Gtk.PolicyType.AUTOMATIC});
    private list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
    readonly button = new Gtk.Button({label: 'Downloads', tooltip_text: 'Downloads'});
    private rows = new Set<() => void>();
    private signal: number;
    private data = new BrowserData();
    constructor(private parent: Gtk.Window, private context: InstanceType<typeof WebKit.WebContext>) {
        this.widget.name = 'browser-downloads'; this.widget.get_style_context().add_class('browser-downloads');
        this.widget.add(this.list);
        this.button.connect('clicked', () => this.widget.set_visible(!this.widget.get_visible()));
        this.signal = context.connect('download-started', (_context, download) => this.add(download));
    }
    private add(download: InstanceType<typeof WebKit.Download>) {
        const row = new Gtk.Box({spacing: 10}); row.name = 'browser-download';
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, hexpand: true});
        const name = new Gtk.Label({label: 'Preparing download…', xalign: 0, ellipsize: 3});
        const status = new Gtk.Label({label: 'Waiting for response…', xalign: 0, ellipsize: 3});
        const progress = new Gtk.ProgressBar();
        const save = new Gtk.Button({label: 'Save', sensitive: false}); save.name = 'browser-download-save';
        const close = new Gtk.Button({label: 'Close', tooltip_text: 'Close and cancel download'}); close.name = 'browser-download-close';
        content.add(name); content.add(status); content.add(progress);
        row.pack_start(content, true, true, 0); row.add(save); row.add(close); this.list.add(row);
        let ended = false, failed = false, removed = false, timer = 0;
        let downloadId = '';
        let saving = false;
        let chooser: Gtk.FileChooserDialog | null = null, filename = 'download';
        const signals: number[] = [];
        const clearTimer = () => {if (timer) {GLib.source_remove(timer); timer = 0;}};
        const cleanPartial = () => {const id = downloadId; downloadId = ''; if (id) void this.data.cancel(id).catch(() => {});};
        const update = () => {
            const received = download.get_received_data_length(), total = download.get_response()?.get_content_length() ?? 0;
            const bytes = GLib.format_size(received);
            if (total > 0) {
                const fraction = Math.min(.99, Math.max(0, download.get_estimated_progress()));
                progress.fraction = fraction;
                status.label = `${Math.floor(fraction * 100)}% · ${bytes} / ${GLib.format_size(total)}`;
            } else {progress.pulse(); status.label = `Downloading… · ${bytes}`;}
        };
        const remove = () => {
            if (removed) return; removed = true;
            chooser?.destroy(); chooser = null; clearTimer();
            if (!ended) download.cancel();
            for (const signal of signals) download.disconnect(signal);
            cleanPartial(); row.destroy(); this.rows.delete(remove);
            this.button.label = this.rows.size ? `Downloads (${this.rows.size})` : 'Downloads';
            if (!this.rows.size) this.widget.hide();
        };
        this.rows.add(remove); close.connect('clicked', remove);
        save.connect('clicked', () => {
            if (chooser || ended || saving) return;
            chooser = new Gtk.FileChooserDialog({title: 'Save download', transient_for: this.parent,
                action: Gtk.FileChooserAction.SAVE, modal: true, do_overwrite_confirmation: true});
            chooser.add_button('Close', Gtk.ResponseType.CANCEL); chooser.add_button('Save', Gtk.ResponseType.ACCEPT);
            chooser.set_current_folder(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) || GLib.get_home_dir());
            chooser.set_current_name(filename);
            chooser.connect('response', async (dialog, response) => {
                const destination = response === Gtk.ResponseType.ACCEPT ? chooser?.get_filename() : null;
                chooser = null; dialog.destroy();
                if (!destination || ended || removed) return;
                if (saving) return; saving = true;
                try {
                    const prepared = await this.data.prepare(destination);
                    if (ended || removed) {void this.data.cancel(prepared.id).catch(() => {}); return;}
                    downloadId = prepared.id;
                    save.no_show_all = true; save.hide(); name.label = prepared.name || filename; name.tooltip_text = destination;
                    status.label = 'Downloading… · 0%';
                    download.set_allow_overwrite(false); download.set_destination(prepared.uri);
                } catch (error) {if (removed) return; saving = false; status.label = String(error); return;}
                timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {update(); return GLib.SOURCE_CONTINUE;});
            }); chooser.show();
        });
        signals.push(download.connect('decide-destination', (_download, suggested) => {
            filename = GLib.path_get_basename(suggested || 'download');
            if (filename === '.' || filename === '..' || filename === '/') filename = 'download';
            name.label = filename; status.label = 'Save this file?'; save.sensitive = true; return true;
        }));
        signals.push(download.connect('failed', (_download, error) => {
            failed = true; clearTimer(); chooser?.destroy(); chooser = null;
            save.no_show_all = true; save.hide(); status.label = `Download failed: ${error.message}`; cleanPartial();
        }));
        signals.push(download.connect('finished', async () => {
            ended = true; clearTimer(); save.no_show_all = true; save.hide(); close.tooltip_text = 'Dismiss download';
            if (failed || removed) return;
            try {
                if (!downloadId) throw new Error('No save destination');
                await this.data.commit(downloadId); downloadId = '';
                if (removed) return;
                progress.fraction = 1;
                status.label = `100% · Complete · ${GLib.format_size(download.get_received_data_length())}`;
            } catch (error) {if (removed) return; status.label = `Could not save download: ${String(error)}`; cleanPartial();}
        }));
        this.button.label = `Downloads (${this.rows.size})`; this.list.show_all(); this.widget.show();
    }
    dispose() {this.context.disconnect(this.signal); for (const remove of [...this.rows]) remove(); this.data.destroy();}
}
