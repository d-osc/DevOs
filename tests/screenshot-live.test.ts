// Run inside an isolated labwc session: exercises grim, layer-shell and real
// keyboard events together, rather than only testing crop geometry.
import {Gtk, Gdk, Gio, GLib, type UIContext} from '@dev-os/core';
import {captureDesktop} from '../src/apps/org.devos.screenshot/capture.js';
import {desktopBounds} from '../src/apps/org.devos.screenshot/geometry.js';
import {SnipOverlay} from '../src/apps/org.devos.screenshot/overlay.js';

Gtk.init(null);
const application = new Gtk.Application({application_id: 'org.devos.ScreenshotTest'});
application.register(null);
const display = Gdk.Display.get_default()!;
const monitors = () => Array.from({length: display.get_n_monitors()}, (_, index) => display.get_monitor(index)!);
const context = {application, display, monitors} as UIContext;
const loop = new GLib.MainLoop(null, false);
let failure: unknown, overlay: SnipOverlay | undefined;
let timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
    timeout = 0;
    failure = new Error('Screenshot overlay did not accept Enter'); loop.quit(); return GLib.SOURCE_REMOVE;
});
void captureDesktop(desktopBounds(monitors().map(monitor => monitor.get_geometry()))).then(frame => {
    // Keep a virtual keyboard present while the overlay maps on headless seats.
    Gio.Subprocess.new(['wtype', '-s', '1000', '-k', 'Return'], Gio.SubprocessFlags.NONE);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
    overlay = new SnipOverlay(context, frame, 'fullscreen', snip => {
        if (failure) return;
        if (!snip || snip.pixbuf.get_width() < 100) failure = new Error('No captured image');
        else print(`PASS: grim capture and overlay Enter produced ${snip.pixbuf.get_width()}x${snip.pixbuf.get_height()} pixels`);
        if (timeout) { GLib.source_remove(timeout); timeout = 0; } loop.quit();
    });
        return GLib.SOURCE_REMOVE;
    });
}).catch(error => {failure = error; if (timeout) {GLib.source_remove(timeout); timeout = 0;} loop.quit();});
loop.run();
overlay?.destroy();
if (failure) throw failure;
