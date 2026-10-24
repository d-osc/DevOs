import {Gtk, baseImage, type SettingsValues} from '@dev-os/core';
import type {FileEntry} from './model.js';
import {parseCustomMenu, customMenuMatches, type CustomMenuItem} from './custom-menu.js';
export function fileContextEntry(widget: Gtk.ListBox | Gtk.FlowBox, x: number, y: number, entries: readonly FileEntry[]) {
    const child = widget instanceof Gtk.ListBox ? widget.get_row_at_y(y) : widget.get_child_at_pos(x, y);
    return child ? entries[child.get_index()] : undefined;
}
export const fileMenuItems = [
    {key: 'contextOpen', title: 'Open', icon: 'document-open-symbolic'},
    {key: 'contextRename', title: 'Rename', icon: 'edit-rename-symbolic'},
    {key: 'contextCopyPath', title: 'Copy path', icon: 'edit-copy-symbolic'},
    {key: 'contextNewFolder', title: 'New folder', icon: 'folder-new-symbolic'},
    {key: 'contextTerminal', title: 'Open in Terminal', icon: 'utilities-terminal-symbolic'},
    {key: 'contextRefresh', title: 'Refresh', icon: 'view-refresh-symbolic'},
    {key: 'contextHidden', title: 'Show hidden files', icon: 'view-reveal-symbolic'},
] as const;
export type FileMenuKey = typeof fileMenuItems[number]['key'];
export type FileMenuOptions = Record<FileMenuKey, boolean> & {contextEnabled: boolean; customItems?: CustomMenuItem[]};
export function fileMenuOptions(values: SettingsValues = {}): FileMenuOptions {
    let customItems: CustomMenuItem[] = [];
    try {customItems = parseCustomMenu(values.contextCustomItems);} catch { /* Keep built-in actions available when custom JSON needs repair. */ }
    return {contextEnabled: values.contextEnabled !== false, customItems, ...Object.fromEntries(fileMenuItems.map(item => [item.key, values[item.key] !== false]))} as FileMenuOptions;
}
export function createFileContextMenu(options: FileMenuOptions, actions: Partial<Record<FileMenuKey, () => void>>, selected: boolean, busy: boolean, hidden: boolean,
    custom?: {target: 'file' | 'folder' | 'background'; activate(item: CustomMenuItem): void}) {
    const menu = new Gtk.Menu(); menu.name = 'files-context-menu'; menu.get_style_context().add_class('files-context-menu');
    if (!options.contextEnabled) return menu;
    for (const item of fileMenuItems) {
        if (!options[item.key] || !actions[item.key]) continue;
        const row: Gtk.MenuItem = item.key === 'contextHidden' ? new Gtk.CheckMenuItem({label: item.title, active: hidden}) : new Gtk.MenuItem();
        if (item.key !== 'contextHidden') {
            const content = new Gtk.Box({spacing: 10});
            content.add(baseImage(item.icon, 16));
            content.add(new Gtk.Label({label: item.title, xalign: 0})); row.add(content);
        }
        row.name = `files-menu-${item.key}`;
        row.sensitive = item.key === 'contextCopyPath' || item.key === 'contextHidden' || (!busy && (!['contextOpen', 'contextRename'].includes(item.key) || selected));
        row.connect('activate', () => actions[item.key]?.()); menu.append(row);
    }
    const items = custom ? (options.customItems ?? []).filter(item => customMenuMatches(item, custom.target)) : [];
    if (items.length && menu.get_children().length) menu.append(new Gtk.SeparatorMenuItem());
    for (const item of items) {
        const row = new Gtk.MenuItem({label: item.title}); row.name = `files-menu-${item.id}`; row.sensitive = !busy;
        row.connect('activate', () => custom!.activate(item)); menu.append(row);
    }
    return menu;
}
