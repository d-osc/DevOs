import {Gio, Gtk, Gdk} from '@dev-os/core';
import {WebKit2 as WebKit} from '@dev-os/core/webkit';

export function browserContextMenu(menu: InstanceType<typeof WebKit.ContextMenu>, view: InstanceType<typeof WebKit.WebView>,
    hit: InstanceType<typeof WebKit.HitTestResult>, openTab: (uri?: string) => void) {
    const original = menu.get_items(), stock = WebKit.ContextMenuAction;
    menu.remove_all();
    const action = (name: string, label: string, run: () => void, enabled = true) => {
        const command = new Gio.SimpleAction({name, enabled}); command.connect('activate', run);
        menu.append(WebKit.ContextMenuItem.new_from_gaction(command, label, null));
    };
    action('back', 'Back', () => view.go_back(), view.can_go_back());
    action('forward', 'Forward', () => view.go_forward(), view.can_go_forward());
    action('reload', 'Reload', () => view.reload());
    menu.append(WebKit.ContextMenuItem.new_separator());
    action('new-tab', 'New tab', () => openTab());
    const link = hit.get_link_uri(), image = hit.get_image_uri();
    if (link && /^https?:\/\//i.test(link)) {
        menu.append(WebKit.ContextMenuItem.new_separator());
        action('open-link-tab', 'Open link in new tab', () => openTab(link));
    }
    if (image && /^(?:https?:|data:image\/)/i.test(image)) {
        menu.append(WebKit.ContextMenuItem.new_separator());
        action('open-image-tab', 'Open image in new tab', () => openTab(image));
    }
    // Keep WebKit's native clipboard, editing, spelling and media actions.
    // New-window actions are replaced by tabs; downloads need their own UI.
    const replaced = new Set([stock.GO_BACK, stock.GO_FORWARD, stock.RELOAD, stock.STOP, stock.OPEN_LINK_IN_NEW_WINDOW,
        stock.OPEN_IMAGE_IN_NEW_WINDOW, stock.OPEN_FRAME_IN_NEW_WINDOW, stock.DOWNLOAD_LINK_TO_DISK, stock.DOWNLOAD_IMAGE_TO_DISK, stock.INSPECT_ELEMENT]);
    let separator = true;
    for (const item of original) {
        if (replaced.has(item.get_stock_action())) continue;
        if (item.is_separator()) {separator = true; continue;}
        if (separator) menu.append(WebKit.ContextMenuItem.new_separator());
        menu.append(item); separator = false;
    }
    menu.append(WebKit.ContextMenuItem.new_separator());
    action('copy-page-address', 'Copy page address', () => {
        const uri = view.get_uri(); if (uri) Gtk.Clipboard.get(Gdk.Atom.intern('CLIPBOARD', false)).set_text(uri, -1);
    }, !!view.get_uri());
    menu.append(WebKit.ContextMenuItem.new_separator());
    // Use WebKit's action so the inspector targets the element under the pointer.
    menu.append(WebKit.ContextMenuItem.new_from_stock_action_with_label(stock.INSPECT_ELEMENT, 'Inspect'));
    return false; // WebKit displays the customized native menu.
}

export function startContextMenu(newTab: () => void, focusAddress: () => void,
    navigation: {back(): void; forward(): void; reload(): void; canBack: boolean; canForward: boolean}) {
    const menu = new Gtk.Menu(); menu.name = 'browser-context-menu';
    for (const [label, run, enabled] of [
        ['Back', navigation.back, navigation.canBack], ['Forward', navigation.forward, navigation.canForward],
        ['Reload', navigation.reload, true],
    ] as const) {
        const item = new Gtk.MenuItem({label, sensitive: enabled}); item.connect('activate', run); menu.append(item);
    }
    menu.append(new Gtk.SeparatorMenuItem());
    for (const [label, run] of [['New tab', newTab], ['Search or enter address', focusAddress]] as const) {
        const item = new Gtk.MenuItem({label}); item.connect('activate', run); menu.append(item);
    }
    menu.append(new Gtk.SeparatorMenuItem());
    menu.append(new Gtk.MenuItem({label: 'Inspect', sensitive: false, tooltip_text: 'Open a web page to inspect its elements. The start page uses native GTK widgets.'}));
    return menu;
}
