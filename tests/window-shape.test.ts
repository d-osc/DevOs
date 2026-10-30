import {Gtk, Gio, GLib} from '@dev-os/core';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Cairo from 'cairo';
import {roundedOpaqueRegion} from '../packages/core/window-shape.js';
import {mountWindowHeader} from '../packages/core/window-header.js';
Gtk.init(null);
const region = roundedOpaqueRegion(0, 0, 2880, 1800, 10, true);
function contains(x: number, y: number) {for (let i = 0; i < region.numRectangles(); i++) {const r = region.getRectangle(i); if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return true;} return false;}
if (!contains(1440, 900) || contains(0, 0) || contains(2879, 1799)) throw new Error('Opaque region includes a corner or misses the interior');
if (roundedOpaqueRegion(0, 0, 2880, 1800, 10, false).numRectangles()) throw new Error('Transparent backgrounds must not advertise opaque pixels');
if (roundedOpaqueRegion(0, 0, 1, 1, 10, true).numRectangles()) throw new Error('Tiny windows have no conservative opaque interior');
const app = new Gtk.Application({application_id: 'org.devos.WindowShapeTest', flags: Gio.ApplicationFlags.NON_UNIQUE}); app.register(null);
const window = new Gtk.ApplicationWindow({application: app, default_width: 640, default_height: 400});
window.name = 'window-shape-test';
const css = new Gtk.CssProvider(); css.load_from_data('#window-shape-test {background: #224466;}');
Gtk.StyleContext.add_provider_for_screen(window.get_screen(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 2);
const header = mountWindowHeader(window, {title: 'Rounded window', iconName: 'utilities-terminal-symbolic'});
const body = new Gtk.Box(); body.add(new Gtk.Label({label: 'Native content'})); window.add(body); window.show_all();
const loop = new GLib.MainLoop(null, false);
let failure: unknown;
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
    const filename = `${GLib.get_tmp_dir()}/devos-window-shape-${GLib.uuid_string_random()}.png`;
    try {
        const content = body.get_allocation(), title = window.get_titlebar()!.get_allocation();
        const x = Math.min(content.x, title.x), y = Math.min(content.y, title.y);
        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, window.get_allocated_width(), window.get_allocated_height());
        const cr = new Cairo.Context(surface); window.draw(cr); surface.writeToPNG(filename); cr.$dispose();
        const image = GdkPixbuf.Pixbuf.new_from_file(filename), pixels = image.get_pixels(), channels = image.get_n_channels(), stride = image.get_rowstride();
        if (channels !== 4) throw new Error('Rounded drawing lost its alpha channel');
        if (pixels[y * stride + x * channels + 3] !== 0) throw new Error('Rounded corner is not transparent');
        if (pixels[(content.y + 20) * stride + (content.x + 20) * channels + 3] !== 255) throw new Error('Native content is no longer opaque');
        print('PASS: direct native drawing retains transparent rounded corners and opaque content; opacity hints exclude corners and transparent themes');
    } catch (error) {failure = error;}
    finally {try {Gio.File.new_for_path(filename).delete(null);} catch {} header.destroy(); window.destroy(); loop.quit();}
    return GLib.SOURCE_REMOVE;
}); loop.run(); if (failure) throw failure;
