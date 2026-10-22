import {Gtk, Gio, GLib} from '@dev-os/core';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import {ROOT} from '@dev-os/config';
import {Windows} from '@dev-os/services/windows';
Gtk.init(null);
const directory = GLib.getenv('DEV_OS_DESKTOP_ANIMATION_TEST');
if (!directory) throw new Error('Use tools/test/desktop-animation-smoke.dev');
const controls = new Windows();
const application = new Gtk.Application({application_id: 'org.devos.DesktopAnimationTest'}); application.register(null);
const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode('#slide-red {background: #ed3030;} #slide-blue {background: #2461ed;} #window-green {background: #20d080;}'));
const red = new Gtk.ApplicationWindow({application, title: 'Slide red'}), blue = new Gtk.ApplicationWindow({application, title: 'Slide blue'});
let redDestroyed = false;
for (const [window, name] of [[red, 'slide-red'], [blue, 'slide-blue']] as const) {
    window.name = name; window.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    window.set_default_size(700, 400); window.maximize(); window.show();
}
const wait = (ms = 10) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function until(check: () => boolean) {for (let i = 0; i < 300; i++) {if (check()) return; await wait();} throw new Error('Animation fixture timed out');}
function capture(name: string) {
    const path = `${ROOT}/build/desktop-animation-native/${name}.png`;
    Gio.Subprocess.new(['grim', path], Gio.SubprocessFlags.NONE).wait_check(null);
    const pixels = GdkPixbuf.Pixbuf.new_from_file(path), data = pixels.get_pixels();
    let red = 0, blue = 0;
    for (let y = 0; y < pixels.get_height(); y += 4) for (let x = 0; x < pixels.get_width(); x += 4) {
        const offset = y * pixels.get_rowstride() + x * pixels.get_n_channels();
        if (data[offset] > 200 && data[offset + 1] < 90 && data[offset + 2] < 90) red++;
        if (data[offset] < 90 && data[offset + 1] < 130 && data[offset + 2] > 200) blue++;
    }
    const center = Math.floor(pixels.get_height() / 2) * pixels.get_rowstride() + Math.floor(pixels.get_width() / 2) * pixels.get_n_channels();
    return {red, blue, center: Array.from(data.slice(center, center + 3))};
}
async function verify() {
    await until(() => controls.desktops.length === 2 && controls.state.some(window => window.title === 'Slide red') && controls.state.some(window => window.title === 'Slide blue'));
    const blueId = controls.state.find(window => window.title === 'Slide blue')!.id;
    controls.moveToDesktop(blueId, 2);
    await until(() => controls.state.some(window => window.id === blueId && window.desktop === 2));
    await wait(350);
    const before = capture('before');
    if (before.red < 1000 || before.blue > 100) throw new Error('Expected the red desktop before switching');
    controls.switchDesktop(2);
    await until(() => controls.desktops.some(desktop => desktop.id === 2 && desktop.active));
    await wait(25);
    const early = capture('early');
    await wait(60);
    const middle = capture('middle');
    await wait(350);
    const after = capture('after');
    if (early.red < 100 || early.blue < 100 || middle.red >= early.red || middle.blue <= early.blue)
        throw new Error(`Desktop images did not slide progressively: ${JSON.stringify({early, middle})}`);
    if (after.red > 100 || after.blue < 1000) throw new Error('Animation did not finish on the blue desktop');
    controls.switchDesktop(1); await wait(35); controls.switchDesktop(2);
    red.destroy(); redDestroyed = true;
    await wait(400);
    const interrupted = capture('interrupted');
    if (interrupted.red > 100 || interrupted.blue < 1000) throw new Error('Interrupted animation left stale content');
    const green = new Gtk.ApplicationWindow({application, title: 'Window animation green'});
    green.name = 'window-green'; green.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    green.maximize(); green.show();
    await until(() => controls.state.some(window => window.title === 'Window animation green'));
    const opening = capture('window-opening');
    await wait(280);
    const opened = capture('window-opened');
    if (opening.center[1] >= opened.center[1] - 3 || opened.center[1] < 200) throw new Error(`Opening did not fade in: ${JSON.stringify({opening, opened})}`);
    green.destroy(); await wait(25);
    const closing = capture('window-closing');
    await wait(220);
    const closed = capture('window-closed');
    if (closing.center[1] <= closed.center[1] + 5 || closed.blue < 1000) throw new Error(`Closing did not retain and fade window content: ${JSON.stringify({closing, closed})}`);
    const quick = new Gtk.ApplicationWindow({application, title: 'Quick animation close'});
    quick.set_default_size(300, 180); quick.show(); await wait(35); quick.destroy(); await wait(250);
    print('PASS: outgoing/incoming frames progress, exact final desktop, rapid reversal and window destruction');
    GLib.file_set_contents(`${directory}/passed`, 'passed');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error; GLib.file_set_contents(`${directory}/failed`, String(error));}).finally(() => loop.quit()); loop.run();
if (!redDestroyed) red.destroy(); blue.destroy(); controls.destroy(); if (failed) throw failed;
