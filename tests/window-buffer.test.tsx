import {Gtk, Gio, GLib, React, Box, Label, DrawingArea, createRoot, mountWindowHeader} from '@dev-os/core';

Gtk.init(null);
const app = new Gtk.Application({application_id: 'org.devos.WindowBufferTest', flags: Gio.ApplicationFlags.NON_UNIQUE});
app.register(null);
const window = new Gtk.ApplicationWindow({application: app, default_width: 1100, default_height: 760});
const root = createRoot(window), header = mountWindowHeader(window, {title: 'Buffer lifetime', iconName: 'system-software-install-symbolic'});
root.render(<Box><Label>Repeated native window painting</Label><DrawingArea widthRequest={200} heightRequest={200} onDraw={(_widget, cr) => {cr.setSourceRGB(.2, .4, .6); cr.paint(); return false;}} /></Box>);
window.show_all();
function memory() {
    const text = new TextDecoder().decode(GLib.file_get_contents('/proc/self/smaps')[1]);
    const blocks = text.split(/(?=^[0-9a-f]+-[0-9a-f]+ )/m).filter(block => block.split('\n')[0].includes('memfd:gdk-wayland'));
    return {buffers: blocks.length, kib: blocks.reduce((sum, block) => sum + Number(/^Rss:\s+(\d+)/m.exec(block)?.[1] ?? 0), 0)};
}
const loop = new GLib.MainLoop(null, false);
let paints = 0, failure: unknown;
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
    if (++paints <= 240) {window.queue_draw(); return GLib.SOURCE_CONTINUE;}
    try {
        const result = memory();
        print(`Window buffer regression: ${JSON.stringify(result)} after ${paints - 1} redraw requests`);
        if (result.buffers > 32 || result.kib > 64 * 1024) throw new Error('Native painting retains too many Wayland buffers');
    } catch (error) {failure = error;}
    finally {root.unmount(); header.destroy(); window.destroy(); loop.quit();}
    return GLib.SOURCE_REMOVE;
});
loop.run();
if (failure) throw failure;
print('PASS: repeated window and JSX drawing release their native buffers without forced garbage collection');
