import {testTheme} from './theme-helper.js';
import {Gtk, Gdk, Gio, GLib, removeTree} from '@dev-os/core';
import {Vte} from '@dev-os/core/vte';
import {ROOT} from '@dev-os/config';
import {TerminalCompletion} from '../extensions/org.devos.terminal/completion.js';
import {QUERY_KEY} from '../extensions/org.devos.terminal/shell-integration.js';
import {commandSuggestions, byteLength, pathPrefix, type CommandInput} from '../extensions/org.devos.terminal/suggestions.js';
Gtk.init(null);
function assert(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function until(check: () => boolean, message: string) {for (let i = 0; i < 160; i++) {if (check()) return; await wait();} throw new Error(message);}
async function run() {
    const input = (line: string, point = byteLength(line)): CommandInput => ({line, point, directory: '/tmp', history: ['git status', 'git switch main'], commands: ['git', 'gio', 'git', 'grep']});
    const items = commandSuggestions(input('gi'));
    assert(items.some(item => item.label === 'git') && items.filter(item => item.label === 'git').length === 1, 'Installed command completion is deduplicated');
    assert(items[0].kind === 'history' && items[0].line === 'git switch main', 'Recent matching commands rank first');
    assert(commandSuggestions(input('git st')).some(item => item.line === 'git status '), 'Subcommands include useful descriptions');
    assert(commandSuggestions(input('gi --help', 2)).some(item => item.line === 'git --help'), 'Middle-of-line completion retains its suffix');
    assert(!commandSuggestions(input('echo a\nb')).length && !pathPrefix(input('cat "file')), 'Multiline and quoted shell syntax remain with native Readline');
    assert(byteLength('ไทย') > 3, 'Readline cursor offsets use UTF-8 bytes');
    const directory = GLib.dir_make_tmp('devos-completion-test-XXXXXX');
    GLib.mkdir_with_parents(`${directory}/Sample folder`, 0o700);
    const window = new Gtk.Window({default_width: 760, default_height: 460}); window.name = 'terminal';
    const terminal = new Vte.Terminal({hexpand: true, vexpand: true});
    const completion = new TerminalCompletion(terminal);
    window.add(completion.widget);
    window.connect('key-press-event', (_window, event) => completion.key(event as unknown as Gdk.Event));
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const snapshot = () => {try {return new TextDecoder().decode(GLib.file_get_contents(`${completion.directory}/state`)[1]).split('\0');} catch {return [];}};
    const key = (keyval: number) => completion.key({get_keyval: () => [true, keyval], get_state: () => [true, 0]} as unknown as Gdk.Event);
    try {
        window.show_all(); window.present(); terminal.grab_focus();
        let environment = GLib.environ_setenv(GLib.get_environ(), 'DEV_OS_TERMINAL_COMPLETION_DIR', completion.directory, true);
        await new Promise<void>((resolve, reject) => terminal.spawn_async(Vte.PtyFlags.DEFAULT, directory, ['/bin/bash', '--rcfile', completion.script, '-i'], environment, GLib.SpawnFlags.DEFAULT, null, -1, null, (_terminal, _pid, error) => {if (error) reject(error); else resolve();}));
        await until(() => snapshot()[0] === 'ready', 'Shell prompt integration did not start'); await wait();
        for (const keyval of [Gdk.KEY_s, Gdk.KEY_y, Gdk.KEY_s]) {key(keyval); terminal.feed_child(String.fromCharCode(keyval));}
        await until(() => completion.visible, 'Automatic command dropdown did not open');
        await wait();
        const panel = completion.widget.get_children().find(widget => widget !== terminal)!;
        const expectedX = Math.max(0, Math.min(terminal.get_allocated_width() - 400, (terminal.get_cursor_position()[0] - 3) * terminal.get_char_width()));
        const [translated, panelX, panelY] = panel.translate_coordinates(completion.widget, 0, 0);
        assert(translated && Math.abs(panelX - expectedX) <= 1, 'Dropdown starts under the typed word and stays within the terminal');
        assert(panelY >= 0 && panelY + panel.get_allocated_height() <= terminal.get_allocated_height(), 'Dropdown stays vertically inside the terminal');
        const descendants = (widget: Gtk.Widget): Gtk.Widget[] => [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(descendants) : [])];
        const firstRow = descendants(panel).find(widget => widget instanceof Gtk.Button)!;
        let hiddenWhileTyping = 0;
        const hideSignal = panel.connect('hide', () => hiddenWhileTyping++);
        key(Gdk.KEY_Shift_L);
        key(Gdk.KEY_t); terminal.feed_child('t');
        assert(completion.visible, 'Typing keeps the dropdown visible while suggestions refresh');
        await until(() => snapshot()[1] === 'syst', 'Updated input did not arrive'); await wait();
        assert(descendants(panel).includes(firstRow), 'Suggestion rows are updated in place');
        key(Gdk.KEY_BackSpace); terminal.feed_child('\x7f');
        await until(() => snapshot()[1] === 'sys', 'Backspace suggestions did not refresh'); await wait();
        assert(completion.visible && hiddenWhileTyping === 0, 'Typing, modifiers and Backspace never hide and reopen a matching dropdown');
        panel.disconnect(hideSignal);

        const screenshot = GLib.getenv('DEV_OS_COMPLETION_SCREENSHOT');
        if (screenshot) {
            const root = window.get_window()!;
            const image = Gdk.pixbuf_get_from_window(root, 0, 0, window.get_allocated_width(), window.get_allocated_height());
            image?.savev(screenshot, 'png', [], []);
        }
        assert(key(Gdk.KEY_Down) && key(Gdk.KEY_Up) && key(Gdk.KEY_Tab), 'Arrows navigate and Tab accepts a real dropdown');
        await wait(); terminal.feed_child(QUERY_KEY);
        await until(() => snapshot()[0] === 'input' && snapshot()[1].startsWith('sys') && snapshot()[1].endsWith(' '), 'Tab did not insert the chosen command');
        assert(!Gio.File.new_for_path(`${directory}/executed`).query_exists(null), 'Accepting never executes a command');
        completion.dismiss(); terminal.feed_child('\x15cd Sam'); await wait(); completion.request();
        await until(() => completion.visible, 'Folder suggestions did not open');
        assert(key(Gdk.KEY_Tab), 'Tab accepts a folder'); await wait(); terminal.feed_child(QUERY_KEY);
        await until(() => snapshot()[1] === 'cd Sample\\ folder/', 'Folder names are safely escaped');
        completion.dismiss(); terminal.feed_child('\x15read -r -s secret; printf done\n');
        await until(() => snapshot()[0] === 'busy', 'Foreground input was not marked busy'); await wait();
        completion.request(); await wait(); assert(!completion.visible, 'Suggestions stay hidden in a password/foreground read');
        terminal.feed_child('private\n'); await until(() => snapshot()[0] === 'ready', 'Shell did not return after foreground input');
        print('PASS: command/history matching, stable dropdown/row reuse while typing, geometry, Bash arrow/Tab insertion, escaped paths, and foreground/password isolation');
    } finally {completion.destroy(); terminal.destroy(); window.destroy(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css); removeTree(directory);}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void run().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
