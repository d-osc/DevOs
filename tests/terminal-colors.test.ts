import {Gtk, GLib} from '@dev-os/core';
import {Vte} from '@dev-os/core/vte';
import {applyTerminalOptions, terminalScheme} from '../extensions/org.devos.terminal/options.js';

Gtk.init(null);
const output = GLib.getenv('DEV_OS_COLOR_SCREENSHOTS');
if (!output) throw new Error('Set DEV_OS_COLOR_SCREENSHOTS to an output directory');
GLib.mkdir_with_parents(output, 0o700);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function run() {
    const family = GLib.getenv('DEV_OS_TEST_FAMILY') === 'github' ? 'github' : 'vscode';
    for (const name of ['dark', 'light'] as const) {
        const scheme = terminalScheme(name, family);
        const window = new Gtk.OffscreenWindow();
        window.set_default_size(960, 470);
        const terminal = new Vte.Terminal({hexpand: true, vexpand: true});
        applyTerminalOptions(terminal, {font: 'Monospace 13'}, name, family);
        terminal.set_cursor_blink_mode(Vte.CursorBlinkMode.OFF);
        window.add(terminal); window.show_all();
        await wait();
        const lines = [
            `\x1b[1m  Dev OS Terminal  /  ${scheme.title}\x1b[0m`, '',
            '\x1b[1;32m  dev@devos\x1b[0m:\x1b[1;34m~/Projects\x1b[0m $ git status',
            '  On branch main',
            '\x1b[32m  Working tree clean\x1b[0m', '',
            '\x1b[31m  Error: file not found\x1b[0m',
            '\x1b[33m  Warning: configuration needs attention\x1b[0m',
            '\x1b[36m  Info: connected to devos.local\x1b[0m', '',
            '  Standard ANSI colors',
            '  ' + Array.from({length: 8}, (_, i) => `\x1b[${30 + i}m${['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'][i].padEnd(11)}\x1b[0m`).join(''),
            '  Bright ANSI colors',
            '  ' + Array.from({length: 8}, (_, i) => `\x1b[${90 + i}m${['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'][i].padEnd(11)}\x1b[0m`).join(''), '',
            '\x1b[1;31m  root@devos\x1b[0m:\x1b[1;34m~\x1b[0m # ',
        ];
        terminal.feed(lines.join('\r\n'));
        await wait();
        const background = terminal.get_color_background_for_draw();
        if (Math.abs(background.red - parseInt(scheme.background.slice(1, 3), 16) / 255) > .01)
            throw new Error(`${name}: VTE background mismatch`);
        const image = window.get_pixbuf();
        if (!image || image.width < 900 || image.height < 400) throw new Error(`${name}: missing rendered screenshot`);
        image.savev(`${output}/terminal-${family}-${name}.png`, 'png', [], []);
        window.destroy();
        print(`PASS: ${name} real VTE render and screenshot`);
    }
}
const loop = new GLib.MainLoop(null, false); let failure: unknown;
void run().catch(error => {failure = error;}).finally(() => loop.quit());
loop.run(); if (failure) throw failure;
