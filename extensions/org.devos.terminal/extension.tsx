import {
    moveTabItem, completeTabMove, Gtk, Gdk, Gio,
    GLib, Pango, React, Box, Label,
    createRoot, useLayoutEffect, useRef, type Root, type UIExtension,
    type UIContext, type VteTypes as Vte
} from '@dev-os/core';
import {mountTabbedHeader, type TabDragHost} from '@dev-os/services/window-tabs';

function TerminalSurface({terminal}: {terminal: Vte.Terminal}) {
    const host = useRef<Gtk.Box>(null);
    useLayoutEffect(() => {
        const box = host.current!; box.add(terminal); terminal.show();
        return () => { box.remove(terminal); };
    }, [terminal]);
    return <Box className="terminal-surface" ref={host} expand hexpand vexpand borderWidth={8} />;
}
interface TerminalTab {
    id: number; owner: TerminalWindow; title: string; directory: string; page: Gtk.Box; root: Root;
    cancel: Gio.Cancellable; terminal?: Vte.Terminal; disposed: boolean;
}
export class TerminalWindow implements TabDragHost {
    readonly tabGroup = 'terminal';
    window: Gtk.ApplicationWindow;
    private stack = new Gtk.Stack();
    private tabs: TerminalTab[] = [];
    private active = 0;
    private nextId = 1;
    private disposed = false;
    private header: ReturnType<typeof mountTabbedHeader>;
    private clipboardFormat?: Vte.Format;
    private vte = import('@dev-os/core').then(({Vte}) => ({default: Vte}));
    constructor(private context: UIContext, directory: string | undefined, private closed: (terminal: TerminalWindow) => void,
        private lifecycle: {empty?: boolean; opened?(terminal: TerminalWindow): void} = {}) {
        // Keep a rejected import handled until a tab displays the dependency error.
        void this.vte.catch(() => {});
        this.window = new Gtk.ApplicationWindow({application: context.application, title: 'Dev OS Terminal', default_width: 880, default_height: 560});
        this.window.name = 'terminal'; this.window.add(this.stack); this.stack.show();
        this.header = mountTabbedHeader(this.window, {title: 'Terminal', iconName: 'utilities-terminal-symbolic', windowIconName: 'utilities-terminal', iconId: 'terminal-window-icon'});
        this.window.connect('delete-event', () => { this.destroy(); return true; });
        this.window.connect('key-press-event', (_window, event) => {
            const native = event as unknown as Gdk.Event, key = native.get_keyval()[1], modifiers = native.get_state()[1];
            if (!(modifiers & Gdk.ModifierType.CONTROL_MASK)) return false;
            if (key === Gdk.KEY_Tab || key === Gdk.KEY_ISO_Left_Tab) { this.cycleTab(modifiers & Gdk.ModifierType.SHIFT_MASK ? -1 : 1); return true; }
            if (modifiers & Gdk.ModifierType.SHIFT_MASK) {
                if ([Gdk.KEY_t, Gdk.KEY_T].includes(key)) { this.addTab(); return true; }
                if ([Gdk.KEY_w, Gdk.KEY_W].includes(key)) { this.closeTab(this.active); return true; }
                const terminal = this.current?.terminal;
                if ([Gdk.KEY_c, Gdk.KEY_C].includes(key) && terminal && this.clipboardFormat !== undefined) { terminal.copy_clipboard_format(this.clipboardFormat); return true; }
                if ([Gdk.KEY_v, Gdk.KEY_V].includes(key) && terminal) { terminal.paste_clipboard(); return true; }
            }
            return false;
        });
        if (!lifecycle.empty) { this.addTab(directory ?? GLib.get_home_dir()); this.show(); }
        lifecycle.opened?.(this);
    }
    private get current() { return this.tabs.find(tab => tab.id === this.active); }
    get activeTabId() { return this.active; }
    get terminal() { return this.current?.terminal; }
    private directory() {
        const tab = this.current, uri = tab?.terminal?.get_current_directory_uri();
        return (uri && Gio.File.new_for_uri(uri).get_path()) || tab?.directory || GLib.get_home_dir();
    }
    private renderTabs() {
        this.header.update({tabs: this.tabs.map(tab => ({id: tab.id, label: tab.title, tooltip: tab.title, iconName: 'utilities-terminal-symbolic'})), active: this.active,
            select: id => this.selectTab(id), close: id => this.closeTab(id), add: () => this.addTab(), drag: this});
    }
    addTab(directory = this.directory()) {
        if (this.disposed) return;
        const page = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL}), id = this.nextId++;
        const tab: TerminalTab = {id, owner: this, page, root: createRoot(page), directory, title: 'Terminal', cancel: new Gio.Cancellable(), disposed: false};
        this.tabs.push(tab); this.stack.add_named(page, String(id)); page.show();
        tab.root.render(<Box borderWidth={16}><Label>Starting shell…</Label></Box>);
        this.selectTab(id); void this.spawn(tab); return id;
    }
    private async spawn(tab: TerminalTab) {
        try {
            const {default: Vte} = await this.vte;
            if (tab.disposed) return;
            tab.owner.clipboardFormat = Vte.Format.TEXT;
            const terminal = tab.terminal = new Vte.Terminal({hexpand: true, vexpand: true});
            const values = this.context.preferences.get('org.devos.terminal').state.values;
            terminal.set_font(Pango.FontDescription.from_string(String(values.font))); terminal.set_scrollback_lines(Number(values.scrollback));
            terminal.set_allow_hyperlink(true); terminal.set_audible_bell(false);
            const foreground = new Gdk.RGBA(), background = new Gdk.RGBA(); foreground.parse('#dfe3eb'); background.parse('#181b21');
            terminal.set_colors(foreground, background, null);
            terminal.connect('child-exited', () => { if (!tab.disposed) tab.owner.closeTab(tab.id); });
            terminal.connect('notify::window-title', () => {
                if (tab.disposed) return;
                tab.title = terminal.get_window_title() || 'Terminal';
                if (tab.owner.active === tab.id) tab.owner.window.set_title(`Dev OS Terminal · ${tab.title}`);
                tab.owner.renderTabs();
            });
            tab.root.render(<TerminalSurface terminal={terminal} />);
            if (tab.owner.active === tab.id) terminal.grab_focus();
            terminal.spawn_async(Vte.PtyFlags.DEFAULT, tab.directory, [Vte.get_user_shell() || '/bin/sh'], GLib.get_environ(), GLib.SpawnFlags.SEARCH_PATH,
                null, -1, tab.cancel, (_terminal, _pid, error) => {
                    if (tab.disposed) return;
                    if (error) tab.root.render(<Box borderWidth={16}><Label wrap>{`Could not start shell: ${error.message}`}</Label></Box>);
                    else print(`Dev OS Terminal ready: ${tab.directory}`);
                });
        } catch (error) {
            if (!tab.disposed) tab.root.render(<Box borderWidth={16}><Label wrap>{`Terminal requires gir1.2-vte-2.91. ${String(error)}`}</Label></Box>);
        }
    }
    selectTab(id: number) {
        const tab = this.tabs.find(tab => tab.id === id); if (!tab) return;
        this.active = id; this.stack.set_visible_child(tab.page);
        this.window.set_title(tab.title === 'Terminal' ? 'Dev OS Terminal' : `Dev OS Terminal · ${tab.title}`);
        this.renderTabs(); tab.terminal?.grab_focus();
    }
    cycleTab(direction: number) {
        const index = this.tabs.findIndex(tab => tab.id === this.active);
        if (this.tabs.length) this.selectTab(this.tabs[(index + direction + this.tabs.length) % this.tabs.length].id);
    }
    detachTab(id: number) {
        if (this.disposed || !this.tabs.some(tab => tab.id === id)) return;
        const destination = new TerminalWindow(this.context, undefined, this.closed, {empty: true, opened: this.lifecycle.opened});
        this.moveTab(id, destination); destination.show();
    }
    moveTab(id: number, destination: TabDragHost, before?: number) {
        if (!(destination instanceof TerminalWindow) || this.disposed || destination.disposed) return;
        const moved = moveTabItem(this.tabs, destination.tabs, id, before, tab => {
            this.stack.remove(tab.page); tab.owner = destination; tab.id = destination.nextId++;
            destination.stack.add_named(tab.page, String(tab.id));
            destination.clipboardFormat = this.clipboardFormat;
        });
        completeTabMove(moved, destination !== this, {
            tabs: this.tabs, active: this.active, removed: id,
            empty: () => this.destroy(), select: id => this.selectTab(id), refresh: () => this.renderTabs(),
        }, destination);
    }
    private disposeTab(tab: TerminalTab) { tab.disposed = true; tab.cancel.cancel(); tab.root.unmount(); tab.terminal?.destroy(); }
    closeTab(id: number) {
        const index = this.tabs.findIndex(tab => tab.id === id); if (index < 0) return;
        if (this.tabs.length === 1) { this.destroy(); return; }
        const [tab] = this.tabs.splice(index, 1); this.disposeTab(tab); this.stack.remove(tab.page); tab.page.destroy();
        if (this.active === id) this.selectTab(this.tabs[Math.min(index, this.tabs.length - 1)].id); else this.renderTabs();
    }
    show() { this.window.show(); this.window.present(); this.current?.terminal?.grab_focus(); }
    destroy() {
        if (this.disposed) return; this.disposed = true;
        for (const tab of this.tabs) this.disposeTab(tab);
        this.tabs = []; this.header.destroy(); this.window.destroy(); this.closed(this);
    }
}
export default {id: 'org.devos.terminal', activate(context) {
    const windows = new Set<TerminalWindow>();
    context.registerCommand('terminal.native', (_monitor, directory) => {
        context.invoke('launcher.hide');
        new TerminalWindow(context, directory, terminal => windows.delete(terminal), {opened: terminal => windows.add(terminal)});
    });
    return () => { for (const window of [...windows]) window.destroy(); };
}} satisfies UIExtension;
