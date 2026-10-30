import {Gtk, baseImage, type SettingsValues} from '@dev-os/core';
import {parseCustomMenu, customMenuMatches, type CustomMenuItem} from '../../../src/apps/org.devos.files/custom-menu.js';
import type {PanelMenuRow} from '../../../packages/compat/panel-menu.js';
/** Production renderer: rows have already been prepared by DevLang. */
export function createPreparedPanelMenu(rows: PanelMenuRow[], activate: (key: string, title: string) => void) {
    const menu = new Gtk.Menu(); menu.name = 'panel-context-menu'; menu.get_style_context().add_class('desktop-context-menu');
    for (const item of rows) {
        if (item.separator) {menu.append(new Gtk.SeparatorMenuItem()); continue;}
        const row = new Gtk.MenuItem(); row.name = `panel-menu-${item.key}`;
        if (item.custom) row.set_label(item.title ?? '');
        else {const content = new Gtk.Box({spacing: 10}); content.add(baseImage(item.icon ?? '', 16)); content.add(new Gtk.Label({label: item.title ?? '', xalign: 0})); row.add(content);}
        row.connect('activate', () => activate(item.key ?? '', item.title ?? '')); menu.append(row);
    }
    return menu;
}
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
        const content = new Gtk.Box({spacing: 10}); content.add(baseImage(item.icon, 16));
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
