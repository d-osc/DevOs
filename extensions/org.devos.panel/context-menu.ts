import {Gtk, type SettingsValues} from '@dev-os/core';
import {parseCustomMenu, customMenuMatches, type CustomMenuItem} from '../org.devos.files/custom-menu.js';
export const panelMenuItems = [
    {key: 'menuPanelSettings', title: 'Panel settings', icon: 'view-more-symbolic'},
    {key: 'menuApplications', title: 'Applications', icon: 'view-app-grid-symbolic'},
    {key: 'menuTerminal', title: 'Terminal', icon: 'utilities-terminal-symbolic'},
    {key: 'menuAppStore', title: 'App Store', icon: 'system-software-install-symbolic'},
    {key: 'menuDiskManager', title: 'Disk Manager', icon: 'drive-harddisk-symbolic'},
    {key: 'menuTaskManager', title: 'Task Manager', icon: 'utilities-system-monitor-symbolic'},
    {key: 'menuFiles', title: 'Files', icon: 'folder-symbolic'},
    {key: 'menuClockSettings', title: 'Clock settings', icon: 'preferences-system-time-symbolic'},
    {key: 'menuSettings', title: 'Settings', icon: 'preferences-system-symbolic'},
] as const;
export type PanelMenuKey = typeof panelMenuItems[number]['key'];
export function createPanelMenu(values: SettingsValues, actions: Record<PanelMenuKey, () => void>, custom: (item: CustomMenuItem) => void) {
    const menu = new Gtk.Menu(); menu.name = 'panel-context-menu'; menu.get_style_context().add_class('desktop-context-menu');
    if (values.contextEnabled === false) return menu;
    for (const item of panelMenuItems) {
        if (values[item.key] === false) continue;
        const row = new Gtk.MenuItem(); row.name = `panel-menu-${item.key}`;
        const content = new Gtk.Box({spacing: 10}); content.add(new Gtk.Image({icon_name: item.icon, pixel_size: 16}));
        content.add(new Gtk.Label({label: item.title, xalign: 0})); row.add(content);
        row.connect('activate', actions[item.key]); menu.append(row);
    }
    let items: CustomMenuItem[] = [];
    try {items = parseCustomMenu(values.contextCustomItems).filter(item => customMenuMatches(item, 'background'));} catch { /* Preserve defaults when custom definitions need repair. */ }
    if (items.length && menu.get_children().length) menu.append(new Gtk.SeparatorMenuItem());
    for (const item of items) {
        const row = new Gtk.MenuItem({label: item.title}); row.name = `panel-menu-${item.id}`;
        row.connect('activate', () => custom(item)); menu.append(row);
    }
    return menu;
}
