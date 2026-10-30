import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, createRoot} from '@dev-os/core';
import {CameraSettings} from '../src/apps/org.devos.camera/settings-view.js';
Gtk.init(null);
const base = GLib.getenv('DEV_OS_ROOT')!;
const css = new Gtk.CssProvider();
css.load_from_data(new TextDecoder().decode(GLib.file_get_contents(`${base}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme()));
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
function all(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(all) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function run() {
    for (const state of ['empty', 'detected', 'error']) {
        const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(800, 850);
        const body = new Gtk.Box(); window.add(body); const root = createRoot(body);
        let opened = false, reads = 0;
        root.render(<CameraSettings open={() => {opened = true;}} inspect={async () => {
            reads++; if (state === 'error') throw new Error('Camera discovery unavailable');
            return state === 'detected' ? ['Example USB Camera'] : [];
        }} />);
        try {
            window.show_all(); await wait();
            const children = all(body), labels = children.filter(widget => widget instanceof Gtk.Label).map(widget => (widget as Gtk.Label).label).join('\n');
            if (state === 'empty' && !labels.includes('No camera detected')) throw new Error('Missing honest empty state');
            if (state === 'detected' && !labels.includes('Example USB Camera')) throw new Error('Device missing');
            if (state === 'error' && !labels.includes('Camera discovery unavailable')) throw new Error('Missing error');
            const button = children.find(widget => widget.name === 'camera-settings-open') as Gtk.Button;
            button.emit('clicked'); if (!opened) throw new Error('Camera launch failed');
            (children.find(widget => widget.name === 'camera-settings-refresh') as Gtk.Button).emit('clicked');
            await wait(); if (reads !== 2) throw new Error('Refresh failed');
            window.get_pixbuf()!.savev(`${base}/build/camera-settings-${state}.png`, 'png', [], []);
            print(`PASS: Camera Settings ${state}, refresh, launch and GTK render (fixture discovery)`);
        } finally {root.unmount(); window.destroy();}
    }
}
const loop = new GLib.MainLoop(null, false); let failure: unknown;
void run().catch(error => {failure = error;}).finally(() => loop.quit());
loop.run(); if (failure) throw failure;
