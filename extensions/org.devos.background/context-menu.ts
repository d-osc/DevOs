import {Gtk, type SettingsValues} from '@dev-os/core';
import {parseCustomMenu, customMenuMatches, type CustomMenuItem} from '../org.devos.files/custom-menu.js';
export const backgroundMenuItems = [
    {key: 'menuWidgets', title: 'Desktop widgets', icon: 'list-add-symbolic'},
    {key: 'menuApplications', title: 'Applications', icon: 'view-app-grid-symbolic'},
    {key: 'menuTerminal', title: 'Terminal', icon: 'utilities-terminal-symbolic'},
    {key: 'menuFiles', title: 'Files', icon: 'folder-symbolic'},
    {key: 'menuBackground', title: 'Background settings', icon: 'preferences-desktop-wallpaper-symbolic'},
    {key: 'menuSettings', title: 'Settings', icon: 'preferences-system-symbolic'},
    {key: 'menuReload', title: 'Reload shell', icon: 'view-refresh-symbolic'},
    {key: 'menuLock', title: 'Lock', icon: 'system-lock-screen-symbolic'},
    {key: 'menuLogout', title: 'Log out', icon: 'system-log-out-symbolic'},
] as const;
export type BackgroundMenuKey = typeof backgroundMenuItems[number]['key'];
export function createBackgroundMenu(values: SettingsValues, actions: Record<BackgroundMenuKey, () => void>, custom: (item: CustomMenuItem) => void) {
    const menu = new Gtk.Menu(); menu.name = 'background-context-menu'; menu.get_style_context().add_class('desktop-context-menu');
    if (values.contextEnabled === false) return menu;
    for (const item of backgroundMenuItems) {
        if (values[item.key] === false) continue;
        const row = new Gtk.MenuItem(); row.name = `background-menu-${item.key}`;
        const content = new Gtk.Box({spacing: 10}); content.add(new Gtk.Image({icon_name: item.icon, pixel_size: 16}));
        content.add(new Gtk.Label({label: item.title, xalign: 0})); row.add(content);
        row.connect('activate', actions[item.key]); menu.append(row);
    }
    let items: CustomMenuItem[] = [];
    try {items = parseCustomMenu(values.contextCustomItems).filter(item => customMenuMatches(item, 'background'));} catch { /* Defaults remain available if custom JSON needs repair. */ }
    if (items.length && menu.get_children().length) menu.append(new Gtk.SeparatorMenuItem());
    for (const item of items) {
        const row = new Gtk.MenuItem({label: item.title}); row.name = `background-menu-${item.id}`;
        row.connect('activate', () => custom(item)); menu.append(row);
    }
    return menu;
}
