import {Gtk, Gdk, Gio, GLib} from '../../src/gtk.js';
import type {UIContext} from '../../src/extensions/runtime.js';
import {FileBrowser} from './model.js';
import {mountFiles} from './view.js';
import {mountTabbedHeader, type TabDragHost} from '../../src/window-tabs.js';

interface FileTab {id: number; owner: Files; page: Gtk.Box; model: FileBrowser; view: ReturnType<typeof mountFiles>; unsubscribe: () => void;}

export class Files implements TabDragHost {
    readonly tabGroup = 'files';
    window: Gtk.ApplicationWindow;
    private stack = new Gtk.Stack();
    private tabs: FileTab[] = [];
    private active = 0;
    private nextId = 1;
    private disposed = false;
    private header: ReturnType<typeof mountTabbedHeader>;
    get model() { return this.current.model; }
    get activeTabId() { return this.active; }
    private get current() { return this.tabs.find(tab => tab.id === this.active)!; }
    private get view() { return this.current.view; }
    constructor(private context: UIContext, private closed: (files: Files) => void,
        private lifecycle: {empty?: boolean; opened?(files: Files): void} = {}) {
        this.window = new Gtk.ApplicationWindow({application: context.application, title: 'Dev OS Files', default_width: 960, default_height: 620});
        this.window.name = 'files';
        this.window.add(this.stack); this.stack.show();
        this.header = mountTabbedHeader(this.window, {title: 'Files', iconName: 'folder-symbolic', windowIconName: 'system-file-manager', iconId: 'files-window-icon'});
        this.window.connect('delete-event', () => { this.destroy(); return true; });
        this.window.connect('key-press-event', (_window, event) => {
            const native = event as unknown as Gdk.Event, key = native.get_keyval()[1], modifiers = native.get_state()[1];
            if ((modifiers & Gdk.ModifierType.CONTROL_MASK) && [Gdk.KEY_p, Gdk.KEY_P].includes(key)) { this.view.quickOpen(); return true; }
            if (this.view.searchKey(key, !!(modifiers & Gdk.ModifierType.SHIFT_MASK))) return true;
            if ([Gdk.KEY_Return, Gdk.KEY_KP_Enter].includes(key)) {
                const focus = this.window.get_focus();
                if (focus instanceof Gtk.Entry && focus.name === 'files-location') { void this.model.navigate(focus.get_text()); return true; }
                if (focus instanceof Gtk.Entry && focus.name === 'files-name') { this.view.submitName(); return true; }
            }
            if (modifiers & Gdk.ModifierType.CONTROL_MASK) {
                if ([Gdk.KEY_t, Gdk.KEY_T].includes(key) && !(modifiers & Gdk.ModifierType.SHIFT_MASK)) { this.addTab(); return true; }
                if (key === Gdk.KEY_Tab || key === Gdk.KEY_ISO_Left_Tab) { this.cycleTab(modifiers & Gdk.ModifierType.SHIFT_MASK ? -1 : 1); return true; }
                if (key === Gdk.KEY_1) { this.view.setGrid(false); return true; }
                if (key === Gdk.KEY_2) { this.view.setGrid(true); return true; }
                if ((modifiers & Gdk.ModifierType.SHIFT_MASK) && [Gdk.KEY_t, Gdk.KEY_T].includes(key)) { context.runCommand('terminal', this.model.state.directory); return true; }
                if ([Gdk.KEY_l, Gdk.KEY_L].includes(key)) { this.view.focusAddress(); return true; }
                if ([Gdk.KEY_h, Gdk.KEY_H].includes(key)) { this.view.toggleHidden(); return true; }
                if ([Gdk.KEY_w, Gdk.KEY_W].includes(key)) { this.closeTab(this.active); return true; }
            }
            if (key === Gdk.KEY_F5) { void this.model.refresh(); return true; }
            if (modifiers & Gdk.ModifierType.MOD1_MASK) {
                if (key === Gdk.KEY_Left) { void this.model.back(); return true; }
                if (key === Gdk.KEY_Right) { void this.model.forward(); return true; }
            }
            return false;
        });
        const start = context.preferences.get('org.devos.files').state.values.homeDirectory;
        if (!lifecycle.empty) { this.addTab(typeof start === 'string' ? start : '~'); this.show(); }
        lifecycle.opened?.(this);
    }
    private options() {
        const values = this.context.preferences.get('org.devos.files').state.values;
        return {gridView: values.gridView === true, showHidden: values.showHidden === true, searchExcludedDirectories: typeof values.searchExcludedDirectories === 'string' ? values.searchExcludedDirectories : undefined};
    }
    private renderTabs() {
        this.header.update({tabs: this.tabs.map(tab => ({id: tab.id,
            label: tab.model.state.directory === GLib.get_home_dir() ? 'Home' : GLib.path_get_basename(tab.model.state.directory) || 'Files',
            tooltip: tab.model.state.directory, iconName: 'folder-symbolic'})), active: this.active,
            select: id => this.selectTab(id), close: id => this.closeTab(id), add: () => this.addTab(), drag: this});
    }
    addTab(directory = this.tabs.length ? this.model.state.directory : '~') {
        if (this.disposed) return;
        const id = this.nextId++, page = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        const model = new FileBrowser((uri, cancel) => new Promise<void>((resolve, reject) => {
            Gio.AppInfo.launch_default_for_uri_async(uri, this.context.display.get_app_launch_context(), cancel, (_source, result) => {
                try { Gio.AppInfo.launch_default_for_uri_finish(result); resolve(); } catch (error) { reject(error); }
            });
        }));
        const view = mountFiles(this.window, model, this.options(), page);
        const tab: FileTab = {id, owner: this, page, model, view, unsubscribe: () => {}};
        this.tabs.push(tab); this.stack.add_named(page, String(id)); page.show();
        let previous = '';
        tab.unsubscribe = model.subscribe(() => {
            const state = model.state;
            if (tab.owner.active === tab.id) tab.owner.window.set_title(`Dev OS Files · ${state.directory}`);
            tab.owner.renderTabs();
            if (!state.loading && !state.error && previous !== state.directory) { previous = state.directory; print(`Dev OS Files ready: ${state.directory}`); }
        });
        this.selectTab(id); void model.navigate(directory);
        return id;
    }
    selectTab(id: number) {
        const tab = this.tabs.find(tab => tab.id === id); if (!tab) return;
        this.active = id; this.stack.set_visible_child(tab.page);
        this.window.set_title(`Dev OS Files · ${tab.model.state.directory}`); this.renderTabs();
    }
    cycleTab(direction: number) {
        const index = this.tabs.findIndex(tab => tab.id === this.active);
        if (this.tabs.length) this.selectTab(this.tabs[(index + direction + this.tabs.length) % this.tabs.length].id);
    }
    detachTab(id: number) {
        if (this.disposed || !this.tabs.some(tab => tab.id === id)) return;
        const destination = new Files(this.context, this.closed, {empty: true, opened: this.lifecycle.opened});
        this.moveTab(id, destination); destination.show();
    }
    moveTab(id: number, destination: TabDragHost, before?: number) {
        if (!(destination instanceof Files) || this.disposed || destination.disposed) return;
        const index = this.tabs.findIndex(tab => tab.id === id); if (index < 0 || (destination === this && before === id)) return;
        const [tab] = this.tabs.splice(index, 1);
        if (destination !== this) {
            this.stack.remove(tab.page); tab.owner = destination; tab.id = destination.nextId++;
            destination.stack.add_named(tab.page, String(tab.id));
        }
        const at = destination.tabs.findIndex(item => item.id === before);
        destination.tabs.splice(at < 0 ? destination.tabs.length : at, 0, tab);
        destination.selectTab(tab.id);
        if (destination !== this) {
            if (!this.tabs.length) this.destroy();
            else if (this.active === id) this.selectTab(this.tabs[Math.min(index, this.tabs.length - 1)].id);
            else this.renderTabs();
            destination.show();
        }
    }
    closeTab(id: number) {
        const index = this.tabs.findIndex(tab => tab.id === id); if (index < 0) return;
        if (this.tabs.length === 1) { this.destroy(); return; }
        const [tab] = this.tabs.splice(index, 1);
        tab.unsubscribe(); tab.model.dispose(); tab.view.destroy(); this.stack.remove(tab.page); tab.page.destroy();
        if (this.active === id) this.selectTab(this.tabs[Math.min(index, this.tabs.length - 1)].id); else this.renderTabs();
    }
    update() { for (const tab of this.tabs) tab.view.update(this.options()); }
    show() { this.window.show(); this.window.present(); }
    destroy() {
        if (this.disposed) return; this.disposed = true;
        for (const tab of this.tabs) { tab.unsubscribe(); tab.model.dispose(); tab.view.destroy(); }
        this.tabs = []; this.header.destroy(); this.window.destroy(); this.closed(this);
    }
}
