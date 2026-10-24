import {testTheme} from './theme-helper.js';
import {Gdk, Gio, GLib, Gtk, type UIContext} from '@dev-os/core';
import {Capture, Gst, devices} from '../extensions/org.devos.camera/capture.js';
import {MediaWindow} from '../extensions/org.devos.camera/window.js';
Gtk.init(null);
function assert(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
const app = new Gtk.Window({default_width: 640, default_height: 420});
const loop = new GLib.MainLoop(null, false);
let photo = '', audio = '', peaks = 0, errors: string[] = [], phase = 'camera', timer = 0;
const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {errors.push('Capture timed out'); loop.quit(); return GLib.SOURCE_REMOVE;});
const camera = new Capture('camera', message => {
    if (message.startsWith('Saved')) {
        photo = message.slice('Saved · '.length); camera.close(); app.get_child()?.destroy();
        phase = 'microphone'; microphone.start(undefined, true, true);
        timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {timer = 0; microphone.stop(); return GLib.SOURCE_REMOVE;});
    } else if (message.startsWith('Device error:')) {errors.push(message); loop.quit();}
}, () => {}, () => {});
const microphone = new Capture('microphone', message => {
    if (message.startsWith('Saved')) {audio = message.slice('Saved · '.length); loop.quit();}
    else if (message.startsWith('Device error:')) {errors.push(message); loop.quit();}
}, value => {if (value > 0) peaks++;}, () => {});
try {
    camera.start(undefined, false, true, widget => {app.add(widget); app.show_all();});
    timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {timer = 0; camera.photo(); return GLib.SOURCE_REMOVE;});
    loop.run();
    assert(errors.length === 0, errors.join('; ')); assert(phase === 'microphone', 'Camera pipeline did not finish');
    const [, jpeg] = GLib.file_get_contents(photo); assert(jpeg[0] === 255 && jpeg[1] === 216 && jpeg.length > 1000, 'Invalid camera JPEG');
    const [, wav] = GLib.file_get_contents(audio); const text = new TextDecoder().decode(wav.slice(0, 12));
    assert(text.startsWith('RIFF') && text.endsWith('WAVE') && wav.length > 1000, 'Recording was not finalized as WAV');
    assert(peaks > 0, 'Microphone level meter never updated');
    // Enumerate the real system too, without opening hardware or inventing devices.
    print(`Actual devices: ${devices('camera').length} camera(s), ${devices('microphone').length} microphone(s)`);
    const failure = new Capture('camera', () => {}, () => {}, () => {});
    let rejected = false; try {failure.start(undefined, false);} catch {rejected = true;} finally {failure.close();}
    assert(rejected, 'Missing hardware must not silently start a fake source');
    const application = new Gtk.Application({application_id: 'org.devos.MediaTest'}); application.register(null);
    const context = {application, invoke() {}} as unknown as UIContext;
    const theme = new Gtk.CssProvider();
    const [, css] = GLib.file_get_contents(`${GLib.getenv('DEV_OS_ROOT')}/extensions/org.devos.theme/style.css`);
    theme.load_from_data(new TextDecoder().decode(css).replace(/^/, testTheme()));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    for (const kind of ['camera', 'microphone'] as const) {
        const ui = new MediaWindow(context, kind, () => {});
        const painted = new GLib.MainLoop(null, false);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {painted.quit(); return GLib.SOURCE_REMOVE;}); painted.run();
        const native = ui.window.get_window()!;
        const image = Gdk.pixbuf_get_from_window(native, 0, 0, ui.window.get_allocated_width(), ui.window.get_allocated_height());
        assert(image, `${kind} window did not render`);
        image.savev(`${GLib.getenv('DEV_OS_ROOT')}/build/live-usb/${kind}-app.png`, 'png', [], []);
        ui.destroy();
    }
    print(`PASS: native GTK preview, JPEG capture, finalized WAV, live levels (${peaks}), missing-device failure, cleanup`);
} finally {
    camera.close(); microphone.close(); app.destroy(); if (timer) GLib.source_remove(timer); GLib.source_remove(timeout);
    if (photo) GLib.unlink(photo); if (audio) GLib.unlink(audio);
}
