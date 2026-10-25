// devos-splash-window: the Dev OS loading animation as a fullscreen Wayland window (GJS + GTK 3 + cairo).
//
// devos-splash draws on the framebuffer, which stops being visible the moment the compositor takes the display. This window
// continues the very same picture (arc, mark, dot-matrix wordmark and status line, same layout and colours) from the first
// compositor frame until the greeter or the desktop says it is ready:
//   * it creates the "window" milestone after its first frame, so the framebuffer splash can stay still underneath;
//   * the status line follows the milestones (devos-splash --step ...) found in /run/devos-splash.d;
//   * the "ready" milestone fades it out over ~300 ms (the desktop or greeter shows through); Esc, a missing splash
//     directory or the 45 s watchdog close it as well, and the reason goes to /run/devos-splash.log.
// Generated from devos-splash-window.js.in: the font table below is the one of devos-splash.c (checked by tests/splash.test.py).
import Gtk from 'gi://Gtk?version=3.0';
import Gdk from 'gi://Gdk?version=3.0';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import cairo from 'cairo';
import System from 'system';

const STEPS_DIR = GLib.getenv('DEVOS_SPLASH_STEPS') || '/run/devos-splash.d';
const LOG = GLib.getenv('DEVOS_SPLASH_LOG') || '/run/devos-splash.log';
const WATCHDOG = Number(GLib.getenv('DEVOS_SPLASH_WINDOW_TIMEOUT') || 45);
const LOOP = 4.8, FADE_OUT = 0.3, TAU = Math.PI * 2;
const ACCENT = [0x39, 0x94, 0xBC], HIGHLIGHT = [0x48, 0xA0, 0xC7], TEXT = [0xBF, 0xBF, 0xBF], MUTED = [0x6E, 0x6E, 0x6E];
const TEXTS = {system: 'Starting services', session: 'Starting desktop', compositor: 'Loading shell', shell: 'Almost ready'};
const ORDER = ['system', 'session', 'compositor', 'window', 'shell', 'ready'];
const FONT = [[0x00,0x00,0x00,0x00,0x00],[0x00,0x00,0x5F,0x00,0x00],[0x00,0x07,0x00,0x07,0x00],[0x14,0x7F,0x14,0x7F,0x14],[0x24,0x2A,0x7F,0x2A,0x12],[0x23,0x13,0x08,0x64,0x62],[0x36,0x49,0x56,0x20,0x50],[0x00,0x05,0x03,0x00,0x00],[0x00,0x1C,0x22,0x41,0x00],[0x00,0x41,0x22,0x1C,0x00],[0x14,0x08,0x3E,0x08,0x14],[0x08,0x08,0x3E,0x08,0x08],[0x00,0x50,0x30,0x00,0x00],[0x08,0x08,0x08,0x08,0x08],[0x00,0x60,0x60,0x00,0x00],[0x20,0x10,0x08,0x04,0x02],[0x3E,0x51,0x49,0x45,0x3E],[0x00,0x42,0x7F,0x40,0x00],[0x42,0x61,0x51,0x49,0x46],[0x21,0x41,0x45,0x4B,0x31],[0x18,0x14,0x12,0x7F,0x10],[0x27,0x45,0x45,0x45,0x39],[0x3C,0x4A,0x49,0x49,0x30],[0x01,0x71,0x09,0x05,0x03],[0x36,0x49,0x49,0x49,0x36],[0x06,0x49,0x49,0x29,0x1E],[0x00,0x36,0x36,0x00,0x00],[0x00,0x56,0x36,0x00,0x00],[0x08,0x14,0x22,0x41,0x00],[0x14,0x14,0x14,0x14,0x14],[0x00,0x41,0x22,0x14,0x08],[0x02,0x01,0x51,0x09,0x06],[0x32,0x49,0x79,0x41,0x3E],[0x7E,0x11,0x11,0x11,0x7E],[0x7F,0x49,0x49,0x49,0x36],[0x3E,0x41,0x41,0x41,0x22],[0x7F,0x41,0x41,0x22,0x1C],[0x7F,0x49,0x49,0x49,0x41],[0x7F,0x09,0x09,0x09,0x01],[0x3E,0x41,0x49,0x49,0x7A],[0x7F,0x08,0x08,0x08,0x7F],[0x00,0x41,0x7F,0x41,0x00],[0x20,0x40,0x41,0x3F,0x01],[0x7F,0x08,0x14,0x22,0x41],[0x7F,0x40,0x40,0x40,0x40],[0x7F,0x02,0x0C,0x02,0x7F],[0x7F,0x04,0x08,0x10,0x7F],[0x3E,0x41,0x41,0x41,0x3E],[0x7F,0x09,0x09,0x09,0x06],[0x3E,0x41,0x51,0x21,0x5E],[0x7F,0x09,0x19,0x29,0x46],[0x46,0x49,0x49,0x49,0x31],[0x01,0x01,0x7F,0x01,0x01],[0x3F,0x40,0x40,0x40,0x3F],[0x1F,0x20,0x40,0x20,0x1F],[0x3F,0x40,0x38,0x40,0x3F],[0x63,0x14,0x08,0x14,0x63],[0x07,0x08,0x70,0x08,0x07],[0x61,0x51,0x49,0x45,0x43],[0x00,0x7F,0x41,0x41,0x00],[0x02,0x04,0x08,0x10,0x20],[0x00,0x41,0x41,0x7F,0x00],[0x04,0x02,0x01,0x02,0x04],[0x40,0x40,0x40,0x40,0x40],[0x00,0x01,0x02,0x04,0x00],[0x20,0x54,0x54,0x54,0x78],[0x7F,0x48,0x44,0x44,0x38],[0x38,0x44,0x44,0x44,0x20],[0x38,0x44,0x44,0x48,0x7F],[0x38,0x54,0x54,0x54,0x18],[0x08,0x7E,0x09,0x01,0x02],[0x0C,0x52,0x52,0x52,0x3E],[0x7F,0x08,0x04,0x04,0x78],[0x00,0x44,0x7D,0x40,0x00],[0x20,0x40,0x44,0x3D,0x00],[0x7F,0x10,0x28,0x44,0x00],[0x00,0x41,0x7F,0x40,0x00],[0x7C,0x04,0x18,0x04,0x78],[0x7C,0x08,0x04,0x04,0x78],[0x38,0x44,0x44,0x44,0x38],[0x7C,0x14,0x14,0x14,0x08],[0x08,0x14,0x14,0x18,0x7C],[0x7C,0x08,0x04,0x04,0x08],[0x48,0x54,0x54,0x54,0x20],[0x04,0x3F,0x44,0x40,0x20],[0x3C,0x40,0x40,0x20,0x7C],[0x1C,0x20,0x40,0x20,0x1C],[0x3C,0x40,0x30,0x40,0x3C],[0x44,0x28,0x10,0x28,0x44],[0x0C,0x50,0x50,0x50,0x3C],[0x44,0x64,0x54,0x4C,0x44],[0x00,0x08,0x36,0x41,0x00],[0x00,0x00,0x7F,0x00,0x00],[0x00,0x41,0x36,0x08,0x00],[0x10,0x08,0x08,0x10,0x08]];

const note = message => {
    try {
        const stream = Gio.File.new_for_path(LOG).append_to(Gio.FileCreateFlags.NONE, null);
        stream.write_all(`window ${message}\n`, null);
        stream.close(null);
    } catch (error) { /* logging is best effort */ }
};
const reached = name => GLib.file_test(`${STEPS_DIR}/${name}`, GLib.FileTest.EXISTS);
if (!GLib.file_test(STEPS_DIR, GLib.FileTest.IS_DIR)) System.exit(0); // no boot splash this time

Gtk.init(null);
const screen = Gdk.Screen.get_default();
const window = new Gtk.Window({type: Gtk.WindowType.TOPLEVEL, title: 'Dev OS', decorated: false, app_paintable: true});
const visual = screen.get_rgba_visual();
if (visual) window.set_visual(visual);
const area = new Gtk.DrawingArea();
window.add(area);
window.fullscreen();
window.set_keep_above(true);
window.set_skip_taskbar_hint(true);

let closeReason = 'ready', status = 'Starting Dev OS', started = GLib.get_monotonic_time() / 1e6, fadeAt = -1, mapped = false, drew = false, finished = false;
const seconds = () => GLib.get_monotonic_time() / 1e6 - started;

const layout = (width, height) => {
    const u = Math.min(Math.max(Math.min(height / 1080, width / 1500), 0.5), 3);
    const top = (height - 420 * u) / 2;
    return {u, cx: width / 2, cy: top + 130 * u, radius: 56 * u, stroke: Math.max(2.5, 4 * u), word: top + 268 * u, line: top + 338 * u};
};
const dots = (cr, text, x, y, pitch, radius) => { // dot-matrix text, one path
    for (const letter of text) {
        const code = letter.charCodeAt(0), glyph = FONT[code < 32 || code > 126 ? 31 : code - 32];
        for (let col = 0; col < 5; col++) for (let row = 0; row < 7; row++) if (glyph[col] >> row & 1) {
            cr.newSubPath(); cr.arc(x + (col + .5) * pitch, y + (row + .5) * pitch, radius, 0, TAU);
        }
        x += 6 * pitch;
    }
};
const rgba = (cr, color, alpha) => cr.setSourceRGBA(color[0] / 255, color[1] / 255, color[2] / 255, alpha);
const textWidth = (text, pitch) => text.length * 6 * pitch - pitch;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const roundedBox = (cr, x, y, w, h, r) => {
    cr.newSubPath(); cr.arc(x + w - r, y + r, r, -TAU / 4, 0); cr.arc(x + w - r, y + h - r, r, 0, TAU / 4);
    cr.arc(x + r, y + h - r, r, TAU / 4, TAU / 2); cr.arc(x + r, y + r, r, TAU / 2, TAU * 3 / 4); cr.closePath();
};

const paint = (cr, width, height) => {
    const {u, cx, cy, radius, stroke, word, line} = layout(width, height);
    cr.setOperator(cairo.Operator.SOURCE); cr.setSourceRGBA(0, 0, 0, 1); cr.paint(); cr.setOperator(cairo.Operator.OVER);
    // the track and the dev os mark inside the ring
    cr.setLineWidth(stroke); rgba(cr, ACCENT, .10); cr.newPath(); cr.arc(cx, cy, radius, 0, TAU); cr.stroke();
    const k = .62 * u, ox = cx - 54 * k, oy = cy - 52 * k; // mark space: rect 22,32 40x32 radius 2 and a disc at 81,67
    rgba(cr, MUTED, 1); roundedBox(cr, ox + 22 * k, oy + 32 * k, 40 * k, 32 * k, 2 * k); cr.fill();
    cr.newPath(); cr.arc(ox + 81 * k, oy + 67 * k, 5 * k, 0, TAU); cr.fill();
    // wordmark and status line
    const pitch = 5.2 * u, wx = cx - textWidth('DEV OS', pitch) / 2, wy = word - 3.5 * pitch;
    rgba(cr, TEXT, 1); cr.newPath(); dots(cr, 'DEV', wx, wy, pitch, pitch * .43); cr.fill();
    rgba(cr, HIGHLIGHT, 1); cr.newPath(); dots(cr, 'OS', wx + 24 * pitch, wy, pitch, pitch * .43); cr.fill();
    const sp = Math.max(2.4, 3 * u);
    rgba(cr, MUTED, 1); cr.newPath(); dots(cr, status, cx - textWidth(status, sp) / 2, line - 3.5 * sp, sp, sp * .44); cr.fill();
    // the arc: same motion as devos-splash.c, repeating every 4.8 s
    const phase = (seconds() % LOOP) / LOOP;
    const length = (48 + 200 * (.5 - .5 * Math.cos(TAU * 3 * phase))) * TAU / 360, head = TAU * 2 * phase + length * .9;
    const segments = 56;
    cr.setLineWidth(stroke); cr.setLineCap(cairo.LineCap.BUTT);
    for (let i = 0; i < segments; i++) {
        const f = (i + .5) / segments, from = head - length * (i + 1) / segments, to = head - length * i / segments;
        rgba(cr, mix(ACCENT, HIGHLIGHT, Math.pow(1 - f, 3)), Math.pow(1 - f, 1.7));
        cr.newPath(); cr.arc(cx, cy, radius, from, to); cr.stroke();
    }
    const hx = cx + radius * Math.cos(head), hy = cy + radius * Math.sin(head);
    for (const [grow, alpha] of [[4, .05], [3, .08], [2, .12]]) { rgba(cr, ACCENT, alpha); cr.newPath(); cr.arc(hx, hy, stroke * grow * .5, 0, TAU); cr.fill(); }
    rgba(cr, HIGHLIGHT, 1); cr.newPath(); cr.arc(hx, hy, stroke / 2, 0, TAU); cr.fill();
    drew = true;
};
area.connect('draw', (widget, cr) => {
    paint(cr, widget.get_allocated_width(), widget.get_allocated_height());
    cr.$dispose();
    return true;
});
// Test hook: DEVOS_SPLASH_DUMP=/path.png writes one frame (1280x720) after two seconds, for headless checks.
if (GLib.getenv('DEVOS_SPLASH_DUMP')) GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    const surface = new cairo.ImageSurface(cairo.Format.ARGB32, 1280, 720), cr = new cairo.Context(surface);
    paint(cr, 1280, 720); surface.writeToPNG(GLib.getenv('DEVOS_SPLASH_DUMP')); cr.$dispose(); surface.finish();
    return GLib.SOURCE_REMOVE;
});

const finish = reason => {
    if (finished) return;
    finished = true;
    note(`closed: ${reason} after ${seconds().toFixed(1)} s`);
    window.destroy();
    Gtk.main_quit();
};
window.connect('key-press-event', (widget, event) => { if (event.get_keyval()[1] === Gdk.KEY_Escape) finish('Esc'); return false; });
window.connect('map-event', () => {
    mapped = true;
    const blank = Gdk.Cursor.new_for_display(screen.get_display(), Gdk.CursorType.BLANK_CURSOR);
    window.get_window()?.set_cursor(blank);
    return false;
});

// 30 frames per second at most; only the spinner rectangle is redrawn, everything at once after a status change.
let lastSize = '';
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
    if (finished) return GLib.SOURCE_REMOVE;
    const width = area.get_allocated_width(), height = area.get_allocated_height();
    const {cx, cy, radius, stroke} = layout(width, height), extent = radius + 6 * stroke;
    if (`${width}x${height}` !== lastSize) { lastSize = `${width}x${height}`; area.queue_draw(); }
    else area.queue_draw_area(Math.floor(cx - extent), Math.floor(cy - extent), Math.ceil(extent * 2), Math.ceil(extent * 2));
    if (fadeAt >= 0) {
        const fade = Math.max(0, 1 - (seconds() - fadeAt) / FADE_OUT);
        window.set_opacity(fade);
        if (fade <= 0) finish(closeReason);
    }
    return GLib.SOURCE_CONTINUE;
});
// Milestones, the first-frame signal and the watchdog, four times a second.
let windowAnnounced = false;
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
    if (finished) return GLib.SOURCE_REMOVE;
    if (drew && !windowAnnounced) {
        windowAnnounced = true;
        try { Gio.File.new_for_path(`${STEPS_DIR}/window`).create(Gio.FileCreateFlags.NONE, null).close(null); } catch (error) { /* already there */ }
        note('first frame drawn');
    }
    let text = status;
    for (const name of ORDER) if (TEXTS[name] && reached(name)) text = TEXTS[name];
    if (text !== status) { status = text; area.queue_draw(); note(`status ${status}`); }
    if (fadeAt < 0 && reached('ready')) { fadeAt = seconds(); note('ready: fading out'); }
    if (fadeAt < 0 && seconds() > WATCHDOG) { fadeAt = seconds(); closeReason = 'watchdog'; note(`watchdog: not ready after ${WATCHDOG} s, closing`); }
    if (!GLib.file_test(STEPS_DIR, GLib.FileTest.IS_DIR) && fadeAt < 0) { fadeAt = seconds(); closeReason = 'splash directory vanished'; note('splash directory vanished: closing'); }
    return GLib.SOURCE_CONTINUE;
});
window.show_all();
Gtk.main();
