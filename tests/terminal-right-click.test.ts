import {Gtk, Gdk, GLib} from '@dev-os/core';
import {Vte} from '@dev-os/core/vte';
import {terminalOptions} from '../extensions/org.devos.terminal/options.js';
import {rightClickAction, rightClickCopies, runRightClick, connectRightClick} from '../extensions/org.devos.terminal/right-click.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
const flush = () => {while (Gtk.events_pending()) Gtk.main_iteration();};
const clipboard = () => Gtk.Clipboard.get(Gdk.Atom.intern('CLIPBOARD', false));
const text = 'line one\r\nสวัสดีชาวโลก 123\r\nlast';
assert(rightClickCopies() && rightClickCopies({}) && !rightClickCopies({rightClickCopy: false}) && terminalOptions().rightClickCopy && !terminalOptions({rightClickCopy: false}).rightClickCopy, 'Right-click copy defaults on and can be disabled');
assert(rightClickAction(true, true) === 'copy' && rightClickAction(true, false) === 'paste', 'Copy mode copies a selection and pastes otherwise');
assert(rightClickAction(false, true) === 'menu' && rightClickAction(false, false) === 'menu', 'Menu mode always shows the menu');

const window = new Gtk.OffscreenWindow(), terminal = new Vte.Terminal(); window.add(terminal); window.show_all();
terminal.feed(new TextEncoder().encode(text)); flush();
terminal.select_all(); flush();
assert(terminal.get_has_selection(), 'Terminal has a selection');
const expected = terminal.get_text_selected(Vte.Format.TEXT)!;
assert(expected.includes('สวัสดีชาวโลก 123') && expected.includes('\n'), 'Selected text keeps Thai and line breaks');
clipboard().set_text('stale', -1);
runRightClick(terminal, rightClickAction(true, terminal.get_has_selection()), Vte.Format.TEXT); flush();
assert(clipboard().wait_for_text() === expected, 'Right-click with a selection copies exactly what Ctrl+Shift+C copies');
assert(!terminal.get_has_selection(), 'Selection is cleared after copy so the next right-click pastes');

const committed: string[] = [];
terminal.connect('commit', (_terminal, data) => {committed.push(data);});
clipboard().set_text('pasted ไทย', -1);
runRightClick(terminal, rightClickAction(true, false), Vte.Format.TEXT); flush();
const deadline = GLib.get_monotonic_time() + 3e6;
while (!committed.length && GLib.get_monotonic_time() < deadline) Gtk.main_iteration_do(false);
assert(committed.join('').includes('pasted ไทย'), 'Right-click without a selection pastes the clipboard');

// Handler: stubs stand in for GTK events; VTE's own handler stops emission before this runs when mouse tracking owns the click.
function harness(copy: boolean, selected: boolean) {
    const calls: string[] = []; let handler: ((widget: unknown, event: unknown) => boolean) | undefined;
    const stub = {connect_after: (_name: string, callback: typeof handler) => {handler = callback; return 1;}, get_has_selection: () => selected,
        copy_clipboard_format: () => calls.push('copy'), unselect_all: () => calls.push('clear'), paste_clipboard: () => calls.push('paste')};
    let format: Vte.Format | undefined = Vte.Format.TEXT;
    connectRightClick(stub as unknown as Vte.Terminal, () => ({copy, format}));
    const event = (type: Gdk.EventType, button: number) => ({get_event_type: () => type, get_button: () => [true, button]});
    return {calls, press: (button = 3, type = Gdk.EventType.BUTTON_PRESS) => handler!(null, event(type, button)), setFormat: (value: Vte.Format | undefined) => {format = value;}};
}
let h = harness(true, true);
assert(h.press() === true && h.calls.join() === 'copy,clear', 'Right-click press with a selection copies and clears');
h = harness(true, false); assert(h.press() && h.calls.join() === 'paste', 'Right-click press without a selection pastes');
h = harness(true, true); assert(!h.press(1) && !h.press(2) && !h.press(3, Gdk.EventType.DOUBLE_BUTTON_PRESS) && !h.calls.length, 'Other buttons and double clicks pass through');
h = harness(true, true); h.setFormat(undefined); assert(!h.press() && !h.calls.length, 'Nothing happens before the terminal is ready');
terminal.destroy(); window.destroy();
print('PASS: Terminal right-click copies selection (Thai/multi-line), clears it, pastes when empty, honors the setting and passes through other buttons');
