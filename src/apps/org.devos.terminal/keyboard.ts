import {Gdk, type VteTypes as Vte} from '@dev-os/core';
import {NEWLINE_KEY} from './shell-integration.js';

export function terminalClipboardShortcut(event: Gdk.Event, terminal: Vte.Terminal, format: Vte.Format | undefined): boolean {
    const key = event.get_keyval()[1], modifiers = event.get_state()[1];
    // Plain Ctrl+C reaches VTE/PTY unchanged, so the foreground process gets SIGINT.
    if (!(modifiers & Gdk.ModifierType.CONTROL_MASK) || !(modifiers & Gdk.ModifierType.SHIFT_MASK)
        || modifiers & (Gdk.ModifierType.MOD1_MASK | Gdk.ModifierType.SUPER_MASK)) return false;
    if ([Gdk.KEY_c, Gdk.KEY_C].includes(key) && format !== undefined) {terminal.copy_clipboard_format(format); return true;}
    if ([Gdk.KEY_v, Gdk.KEY_V].includes(key)) {terminal.paste_clipboard(); return true;}
    return false;
}

export function insertTerminalNewline(event: Gdk.Event, terminal: Vte.Terminal): boolean {
    const key = event.get_keyval()[1], modifiers = event.get_state()[1];
    if (![Gdk.KEY_Return, Gdk.KEY_KP_Enter].includes(key) || !(modifiers & Gdk.ModifierType.SHIFT_MASK)
        || modifiers & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.MOD1_MASK | Gdk.ModifierType.SUPER_MASK)) return false;
    terminal.feed_child(NEWLINE_KEY);
    return true;
}
