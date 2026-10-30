import {Gdk, Gtk, type SettingsValues, type VteTypes as Vte} from '@dev-os/core';
export type RightClickAction = 'copy' | 'paste' | 'menu';
export function rightClickPastes(values: SettingsValues = {}) { return values.rightClickPaste !== false; }
export function rightClickAction(pasteMode: boolean): RightClickAction {
    return pasteMode ? 'paste' : 'menu';
}
// Right-click pastes even when text is selected; Copy remains available in the menu and via Ctrl+Shift+C.
export function runRightClick(terminal: Vte.Terminal, action: RightClickAction, format: Vte.Format, event?: Gdk.Event) {
    if (action === 'copy') { terminal.copy_clipboard_format(format); terminal.unselect_all(); }
    else if (action === 'paste') terminal.paste_clipboard();
    else {
        const menu = new Gtk.Menu(), selected = terminal.get_has_selection();
        const copy = new Gtk.MenuItem({label: 'Copy'}), paste = new Gtk.MenuItem({label: 'Paste'});
        copy.set_sensitive(selected);
        copy.connect('activate', () => terminal.copy_clipboard_format(format));
        paste.connect('activate', () => terminal.paste_clipboard());
        menu.append(copy); menu.append(paste); menu.connect('selection-done', () => menu.destroy()); menu.show_all();
        if (event) menu.popup_at_pointer(event); else menu.popup_at_pointer(null);
    }
}
// Connected after VTE's own handler: VTE consumes the press when the program enabled mouse tracking (unless Shift is held), so those clicks are never intercepted.
export function connectRightClick(terminal: Vte.Terminal, options: () => {paste: boolean; format: Vte.Format | undefined}) {
    return terminal.connect_after('button-press-event', (_widget, event) => {
        const native = event as unknown as Gdk.Event;
        if (native.get_event_type() !== Gdk.EventType.BUTTON_PRESS || native.get_button()[1] !== 3) return false;
        const {paste, format} = options();
        if (format === undefined) return false;
        runRightClick(terminal, rightClickAction(paste), format, native);
        return true;
    });
}
