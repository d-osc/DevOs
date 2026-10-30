import {Gtk, Gdk, GLib} from '@dev-os/core';
import {Vte} from '@dev-os/core/vte';
import {terminalOptions} from '../src/apps/org.devos.terminal/options.js';
import {rightClickAction, rightClickPastes, runRightClick, connectRightClick} from '../src/apps/org.devos.terminal/right-click.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
const flush = () => {while (Gtk.events_pending()) Gtk.main_iteration();};
const clipboard = () => Gtk.Clipboard.get(Gdk.Atom.intern('CLIPBOARD', false));
const text = 'line one\r\nสวัสดีชาวโลก 123\r\nlast';
assert(rightClickPastes() && rightClickPastes({}) && !rightClickPastes({rightClickPaste: false}) && terminalOptions().rightClickPaste && !terminalOptions({rightClickPaste: false}).rightClickPaste, 'Right-click paste defaults on and can be disabled');
assert(rightClickAction(true) === 'paste', 'Right-click pastes by default');
assert(rightClickAction(false) === 'menu' && rightClickAction(false) === 'menu', 'Menu mode always shows the menu');

const window = new Gtk.OffscreenWindow(), terminal = new Vte.Terminal(); window.add(terminal); window.show_all();
terminal.feed(new TextEncoder().encode(text)); flush();
terminal.select_all(); flush();
assert(terminal.get_has_selection(), 'Terminal has a selection');
const expected = terminal.get_text_selected(Vte.Format.TEXT)!;
assert(expected.includes('สวัสดีชาวโลก 123') && expected.includes('\n'), 'Selected text keeps Thai and line breaks');
clipboard().set_text('stale', -1);
terminal.copy_clipboard_format(Vte.Format.TEXT); flush();
assert(clipboard().wait_for_text() === expected, 'Explicit Copy preserves Thai and line breaks');

const committed: string[] = [];
terminal.connect('commit', (_terminal, data) => {committed.push(data);});
clipboard().set_text('pasted ไทย', -1);
runRightClick(terminal, rightClickAction(true), Vte.Format.TEXT); flush();
const deadline = GLib.get_monotonic_time() + 3e6;
while (!committed.length && GLib.get_monotonic_time() < deadline) Gtk.main_iteration_do(false);
assert(committed.join('').includes('pasted ไทย'), 'Right-click without a selection pastes the clipboard');
assert(clipboard().wait_for_text() === 'pasted ไทย', 'Right-click with a selection does not replace the clipboard with selected text');

// Handler: stubs stand in for GTK events; VTE's own handler stops emission before this runs when mouse tracking owns the click.
function harness(paste: boolean, selected: boolean) {
    const calls: string[] = []; let handler: ((widget: unknown, event: unknown) => boolean) | undefined;
    const stub = {connect_after: (_name: string, callback: typeof handler) => {handler = callback; return 1;}, get_has_selection: () => selected,
        copy_clipboard_format: () => calls.push('copy'), unselect_all: () => calls.push('clear'), paste_clipboard: () => calls.push('paste')};
    let format: Vte.Format | undefined = Vte.Format.TEXT;
    connectRightClick(stub as unknown as Vte.Terminal, () => ({paste, format}));
    const event = (type: Gdk.EventType, button: number) => ({get_event_type: () => type, get_button: () => [true, button]});
    return {calls, press: (button = 3, type = Gdk.EventType.BUTTON_PRESS) => handler!(null, event(type, button)), setFormat: (value: Vte.Format | undefined) => {format = value;}};
}
let h = harness(true, true);
assert(h.press() === true && h.calls.join() === 'paste', 'Right-click press pastes even with a selection');
h = harness(true, false); assert(h.press() && h.calls.join() === 'paste', 'Right-click press without a selection pastes');
h = harness(true, true); assert(!h.press(1) && !h.press(2) && !h.press(3, Gdk.EventType.DOUBLE_BUTTON_PRESS) && !h.calls.length, 'Other buttons and double clicks pass through');
h = harness(true, true); h.setFormat(undefined); assert(!h.press() && !h.calls.length, 'Nothing happens before the terminal is ready');
terminal.destroy(); window.destroy();
print('PASS: Terminal right-click pastes clipboard with or without a selection, keeps Copy available and passes through other buttons');
