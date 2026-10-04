import {Gtk, Gdk, Gio, GLib, Pango} from '../../src/gtk.js';
import {React, Box, Label, Button, Image, createRoot, useLayoutEffect, useRef, useState, type Root} from '@dev-os/react-gtk';
import {mountTabbedHeader, type TabDragHost} from '../../src/window-tabs.js';
import type {UIExtension, UIContext} from '../../src/extensions/runtime.js';
import {EditorDocument} from './document.js';
import {EditorAssets} from './assets.js';
import {MonacoSurface} from './surface.js';
import type {EditorMessage, EditorAction} from './protocol.js';
import {editorFileIcon} from './file-icons.js';
import {configPath} from '../../src/config.js';

interface EditorTab {
    id: number; owner: EditorWindow; document: EditorDocument; page: Gtk.Box; root: Root;
    surface?: MonacoSurface; initialized: boolean; line: number; column: number;
    unsubscribe: () => void;
}
function EditorPage({tab, assets}: {tab: EditorTab; assets: Promise<EditorAssets>}) {
    const host = useRef<Gtk.Box>(null), [, refresh] = useState(0);
    useLayoutEffect(() => {
        const changed = () => refresh(value => value + 1);
        const unsubscribe = tab.document.subscribe(changed);
        const unsubscribePreferences = tab.owner.onPreferences(changed);
        tab.surface = new MonacoSurface(host.current!, assets, message => {
            tab.owner.receive(tab, message); changed();
        }, () => {
            if (tab.surface?.ready && !tab.initialized) { tab.initialized = true; tab.owner.configure(tab, true); }
            changed();
        });
        return () => { unsubscribe(); unsubscribePreferences(); tab.surface?.dispose(); };
    }, [tab, assets]);
    const document = tab.document;
    const parents = document.path ? GLib.path_get_dirname(document.path).split('/').filter(Boolean).slice(-2) : [];
    const preferences = tab.owner.editorPreferences;
    const find = (replace = false) => { void tab.surface?.evaluate(`window.devOsEditor.find(${replace})`).catch(() => {}); };
    return <Box className="editor-body" orientation="vertical" expand hexpand vexpand>
        <Box className="editor-toolbar" spacing={2}>
            <Box id="editor-breadcrumbs" spacing={5} expand tooltip={document.path}>
                {parents.map((part, index) => <Box key={index} spacing={5}><Label className="breadcrumb" ellipsize={Pango.EllipsizeMode.END} maxWidthChars={22}>{part}</Label><Image iconName="go-next-symbolic" pixelSize={10} /></Box>)}
                <Image iconName={editorFileIcon(document.path)} pixelSize={14} />
                <Label className="breadcrumb breadcrumb-file" xalign={0} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={32}>{document.title}</Label>
            </Box>
            <Button id="editor-open" tooltip="Open file · Ctrl + O" onClicked={() => { void tab.owner.chooseOpen(); }}><Image iconName="document-open-symbolic" pixelSize={14} /></Button>
            <Button id="editor-save" tooltip="Save · Ctrl + S" sensitive={!document.loading && !document.saving} onClicked={() => { void tab.owner.saveTab(tab); }}><Image iconName="document-save-symbolic" pixelSize={14} /></Button>
            <Button id="editor-save-as" tooltip="Save as · Ctrl + Shift + S" sensitive={!document.loading && !document.saving} onClicked={() => { void tab.owner.saveTab(tab, true); }}><Image iconName="document-save-as-symbolic" pixelSize={14} /></Button>
            <Button id="editor-find" tooltip="Find · Ctrl + F" sensitive={tab.surface?.ready === true} onClicked={() => find()}><Image iconName="edit-find-symbolic" pixelSize={14} /></Button>
            <Button id="editor-replace" tooltip="Replace · Ctrl + H" sensitive={tab.surface?.ready === true} onClicked={() => find(true)}><Image iconName="edit-find-replace-symbolic" pixelSize={14} /></Button>
            <Button id="editor-settings" tooltip="Open editor settings JSON" onClicked={() => { void tab.owner.openSettings(); }}><Image iconName="preferences-system-symbolic" pixelSize={14} /></Button>
        </Box>
        <Box id="editor-monaco" ref={host} expand hexpand vexpand />
        <Box className="editor-status" spacing={14}>
            <Label className={document.error || tab.surface?.error ? 'error' : 'subtle'} xalign={0} expand ellipsize={Pango.EllipsizeMode.END}>
                {document.error || tab.surface?.error || (document.loading ? 'Opening file…' : document.saving ? 'Saving…' : !tab.surface?.ready ? 'Starting Monaco…' : document.dirty ? 'Unsaved changes' : document.path ? 'Saved' : 'Ready')}
            </Label>
            <Label className="subtle mono">{`Ln ${tab.line}, Col ${tab.column}`}</Label>
            <Label className="subtle">{`Spaces: ${preferences.tabSize}`}</Label>
            <Label className="subtle mono">UTF-8</Label>
            <Label className="subtle">{document.content.includes('\r\n') ? 'CRLF' : 'LF'}</Label>
            <Label className="subtle">{document.language === 'typescript' ? document.path?.endsWith('.tsx') ? 'TypeScript React' : 'TypeScript' : document.language === 'javascript' ? 'JavaScript' : document.language}</Label>
        </Box>
    </Box>;
}

export class EditorWindow implements TabDragHost {
    readonly tabGroup = 'editor';
    readonly window: Gtk.ApplicationWindow;
    private stack = new Gtk.Stack();
    private tabs: EditorTab[] = [];
    private active = 0;
    private nextId = 1;
    private disposed = false;
    private closing = false;
    private dialogs = new Set<Gtk.Dialog>();
    private header: ReturnType<typeof mountTabbedHeader>;
    constructor(private context: UIContext, private assets: Promise<EditorAssets>, private closed: (editor: EditorWindow) => void,
        private lifecycle: {empty?: boolean; opened?(editor: EditorWindow): void} = {}) {
        void assets.catch(() => {});
        this.window = new Gtk.ApplicationWindow({application: context.application, title: 'Dev OS Editor', default_width: 1040, default_height: 620});
        this.window.name = 'editor'; this.window.add(this.stack); this.stack.show();
        this.header = mountTabbedHeader(this.window, {title: 'Editor', iconName: 'dev-os-editor', windowIconName: 'dev-os-editor', iconId: 'editor-window-icon'});
        this.window.connect('delete-event', () => { void this.requestClose(); return true; });
        this.window.connect('key-press-event', (_window, event) => {
            // WebKit dispatches typing asynchronously. Let Monaco handle its own
            // shortcuts after preceding keystrokes instead of saving too early.
            if (this.current?.surface?.view?.has_focus) return false;
            const native = event as unknown as Gdk.Event, key = native.get_keyval()[1], modifiers = native.get_state()[1];
            if (!(modifiers & Gdk.ModifierType.CONTROL_MASK)) return false;
            const shift = !!(modifiers & Gdk.ModifierType.SHIFT_MASK);
            if ([Gdk.KEY_n, Gdk.KEY_N, Gdk.KEY_t, Gdk.KEY_T].includes(key)) { this.addTab(); return true; }
            if ([Gdk.KEY_o, Gdk.KEY_O].includes(key)) { void this.chooseOpen(); return true; }
            if ([Gdk.KEY_s, Gdk.KEY_S].includes(key)) { if (this.current) void this.saveTab(this.current, shift); return true; }
            if ([Gdk.KEY_w, Gdk.KEY_W].includes(key)) { void this.closeTab(this.active); return true; }
            if ([Gdk.KEY_Tab, Gdk.KEY_ISO_Left_Tab].includes(key)) { this.cycleTab(shift ? -1 : 1); return true; }
            return false;
        });
        if (!lifecycle.empty) this.addTab();
        lifecycle.opened?.(this);
    }
    private get current() { return this.tabs.find(tab => tab.id === this.active); }
    get activeTabId() { return this.active; }
    get document() { return this.current?.document; }
    get surface() { return this.current?.surface; }
    get editorPreferences() { return this.context.preferences.get('org.devos.editor').state.values; }
    onPreferences(listener: () => void) { return this.context.preferences.subscribe(listener); }
    private renderTabs() {
        this.header.update({tabs: this.tabs.map(tab => {
            const duplicate = tab.document.path && this.tabs.some(other => other !== tab && other.document.title === tab.document.title);
            const suffix = duplicate ? ` · ${GLib.path_get_basename(GLib.path_get_dirname(tab.document.path!))}` : '';
            return {id: tab.id, label: `${tab.document.dirty ? '● ' : ''}${tab.document.title}${suffix}`,
                widthChars: duplicate ? 24 : 16, tooltip: tab.document.path || 'Untitled', iconName: editorFileIcon(tab.document.path)};
        }), active: this.active,
            select: id => this.selectTab(id), close: id => { void this.closeTab(id); }, add: () => this.addTab(), drag: this});
        if (this.current) this.window.set_title(`Dev OS Editor · ${this.current.document.title}${this.current.document.dirty ? ' *' : ''}`);
    }
    configure(tab: EditorTab, content = false) {
        const values = this.context.preferences.get('org.devos.editor').state.values;
        tab.surface?.configure({...(content ? {content: tab.document.content} : {}), path: tab.document.path, language: tab.document.language,
            readOnly: tab.document.loading, fontSize: Number(values.fontSize), tabSize: Number(values.tabSize), minimap: values.minimap === true});
    }
    applyPreferences() { this.tabs.forEach(tab => this.configure(tab)); }
    receive(tab: EditorTab, message: EditorMessage) {
        if (this.disposed || !this.tabs.includes(tab)) return;
        if (message.type === 'change' && typeof message.content === 'string') tab.document.edit(message.content);
        else if (message.type === 'cursor' && Number.isSafeInteger(message.line) && Number.isSafeInteger(message.column)) {
            tab.line = message.line; tab.column = message.column;
        } else if (message.type === 'action') this.action(tab, message.action);
    }
    private action(tab: EditorTab, action: EditorAction) {
        switch (action) {
        case 'new': this.addTab(); break;
        case 'open': void this.chooseOpen(); break;
        case 'save': void this.saveTab(tab); break;
        case 'saveAs': void this.saveTab(tab, true); break;
        case 'close': void this.closeTab(tab.id); break;
        case 'next': this.cycleTab(1); break;
        case 'previous': this.cycleTab(-1); break;
        }
    }
    addTab() {
        if (this.disposed) return undefined;
        const id = this.nextId++, page = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL}), document = new EditorDocument();
        const tab: EditorTab = {id, owner: this, page, document, root: createRoot(page), initialized: false, line: 1, column: 1, unsubscribe: () => {}};
        this.tabs.push(tab); this.stack.add_named(page, String(id)); page.show();
        tab.unsubscribe = document.subscribe(() => tab.owner.renderTabs());
        tab.root.render(<EditorPage {...{tab, assets: this.assets}} />); this.selectTab(id); return id;
    }
    async openFile(path: string): Promise<boolean> {
        if (this.disposed) return false;
        const existing = this.tabs.find(tab => tab.document.path === path);
        if (existing) { this.selectTab(existing.id); this.show(); return true; }
        let tab = this.current;
        if (!tab || tab.document.path || tab.document.dirty || tab.document.loading) {
            const id = this.addTab(); tab = this.tabs.find(tab => tab.id === id);
        }
        if (!tab) return false;
        const loaded = tab.document.load(path); tab.owner.configure(tab);
        const success = await loaded;
        tab.owner.configure(tab, success);
        if (success) tab.owner.show();
        return success;
    }
    selectTab(id: number) {
        const tab = this.tabs.find(tab => tab.id === id); if (!tab) return;
        this.active = id; this.stack.set_visible_child(tab.page); this.renderTabs(); tab.surface?.focus();
    }
    cycleTab(direction: number) {
        const index = this.tabs.findIndex(tab => tab.id === this.active);
        if (this.tabs.length) this.selectTab(this.tabs[(index + direction + this.tabs.length) % this.tabs.length].id);
    }
    private response(dialog: Gtk.Dialog): Promise<number> {
        this.dialogs.add(dialog);
        return new Promise(resolve => { dialog.connect('response', (_dialog, response) => resolve(response)); dialog.show(); });
    }
    private async chooseFile(save: boolean, tab = this.current): Promise<string | undefined> {
        if (this.disposed) return undefined;
        const dialog = new Gtk.FileChooserDialog({title: save ? 'Save file as' : 'Open file', transient_for: this.window,
            modal: true, action: save ? Gtk.FileChooserAction.SAVE : Gtk.FileChooserAction.OPEN});
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL); dialog.add_button(save ? 'Save' : 'Open', Gtk.ResponseType.ACCEPT);
        dialog.set_local_only(true); dialog.set_do_overwrite_confirmation(save);
        if (tab?.document.path) dialog.set_current_folder(GLib.path_get_dirname(tab.document.path));
        if (save) dialog.set_current_name(tab?.document.title === 'Untitled' ? 'untitled.txt' : tab?.document.title || 'untitled.txt');
        try { return await this.response(dialog) === Gtk.ResponseType.ACCEPT ? dialog.get_filename() ?? undefined : undefined; }
        finally { this.dialogs.delete(dialog); dialog.destroy(); }
    }
    async chooseOpen() { const path = await this.chooseFile(false); if (path) await this.openFile(path); }
    async openSettings(): Promise<boolean> {
        try {
            const path = this.context.preferences.settingsFile?.('org.devos.editor');
            if (!path) throw new Error('Settings files are unavailable');
            return await this.openFile(path);
        } catch (error) { this.current?.document.reportError(String(error)); return false; }
    }
    async saveTab(tab = this.current, saveAs = false): Promise<boolean> {
        if (!tab || this.disposed || tab.document.saving || tab.document.loading) return false;
        // Read the live model before saving, including a keystroke queued on the bridge.
        if (tab.surface?.ready) {
            try { tab.document.edit(await tab.surface.evaluate('window.devOsEditor.getValue()')); }
            catch { return false; }
        }
        const path = saveAs || !tab.document.path ? await this.chooseFile(true, tab) : tab.document.path;
        if (!path || this.disposed) return false;
        const saved = await tab.document.save(path);
        if (saved) {
            try {
                this.context.preferences.reloadSettingsFile?.(path);
                if (path === configPath() && !this.context.reload()) throw new Error('Could not reload desktop settings');
            }
            catch (error) { tab.document.reportError(`File saved, but settings were not applied: ${String(error)}`); }
            tab.owner.configure(tab);
        }
        return saved;
    }
    private async canClose(tab: EditorTab): Promise<boolean> {
        if (tab.document.saving) return false;
        if (tab.surface?.ready && !tab.document.loading) {
            try { tab.document.edit(await tab.surface.evaluate('window.devOsEditor.getValue()')); } catch {}
        }
        if (!tab.document.dirty) return true;
        const dialog = new Gtk.MessageDialog({transient_for: this.window, modal: true, message_type: Gtk.MessageType.QUESTION,
            text: `Save changes to ${tab.document.title}?`, secondary_text: 'Your changes will be lost if you discard them.'});
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL); dialog.add_button('Discard', Gtk.ResponseType.REJECT); dialog.add_button('Save', Gtk.ResponseType.ACCEPT);
        dialog.set_default_response(Gtk.ResponseType.CANCEL);
        let response;
        try { response = await this.response(dialog); }
        finally { this.dialogs.delete(dialog); dialog.destroy(); }
        return response === Gtk.ResponseType.REJECT || (response === Gtk.ResponseType.ACCEPT && await this.saveTab(tab));
    }
    async closeTab(id: number): Promise<boolean> {
        if (this.closing || this.disposed) return false;
        const tab = this.tabs.find(tab => tab.id === id); if (!tab) return false;
        this.closing = true;
        try {
            if (!await this.canClose(tab) || this.disposed) return false;
            const index = this.tabs.indexOf(tab); if (index < 0) return false;
            this.tabs.splice(index, 1); this.disposeTab(tab); this.stack.remove(tab.page); tab.page.destroy();
            if (!this.tabs.length) this.destroy();
            else if (this.active === id) this.selectTab(this.tabs[Math.min(index, this.tabs.length - 1)].id);
            else this.renderTabs(); return true;
        } finally { this.closing = false; }
    }
    async requestClose(): Promise<boolean> {
        if (this.closing || this.disposed) return false;
        this.closing = true;
        try { for (const tab of [...this.tabs]) { if (!await this.canClose(tab) || this.disposed) return false; } this.destroy(); return true; }
        finally { this.closing = false; }
    }
    detachTab(id: number) {
        if (this.disposed || this.closing || !this.tabs.some(tab => tab.id === id)) return;
        const destination = new EditorWindow(this.context, this.assets, this.closed, {empty: true, opened: this.lifecycle.opened});
        this.moveTab(id, destination); destination.show();
    }
    moveTab(id: number, destination: TabDragHost, before?: number) {
        if (!(destination instanceof EditorWindow) || this.disposed || destination.disposed || this.closing || destination.closing) return;
        const index = this.tabs.findIndex(tab => tab.id === id); if (index < 0 || (destination === this && before === id)) return;
        const [tab] = this.tabs.splice(index, 1);
        if (destination !== this) {
            this.stack.remove(tab.page); tab.owner = destination; tab.id = destination.nextId++;
            destination.stack.add_named(tab.page, String(tab.id));
        }
        const at = destination.tabs.findIndex(item => item.id === before);
        destination.tabs.splice(at < 0 ? destination.tabs.length : at, 0, tab); destination.selectTab(tab.id);
        if (destination !== this) {
            if (!this.tabs.length) this.destroy();
            else if (this.active === id) this.selectTab(this.tabs[Math.min(index, this.tabs.length - 1)].id);
            else this.renderTabs(); destination.show();
        }
    }
    show() { if (!this.disposed) { this.window.show(); this.window.present(); this.current?.surface?.focus(); } }
    private disposeTab(tab: EditorTab) { tab.unsubscribe(); tab.document.dispose(); tab.root.unmount(); }
    destroy() {
        if (this.disposed) return; this.disposed = true;
        for (const dialog of this.dialogs) dialog.response(Gtk.ResponseType.CANCEL);
        for (const tab of this.tabs) this.disposeTab(tab);
        this.tabs = []; this.header.destroy(); this.window.destroy(); this.closed(this);
    }
}
export default {id: 'org.devos.editor', activate(context) {
    const windows = new Set<EditorWindow>();
    let assets: Promise<EditorAssets> | undefined;
    const open = () => {
        assets ??= EditorAssets.create(); void assets.catch(() => {});
        return new EditorWindow(context, assets, editor => windows.delete(editor), {opened: editor => windows.add(editor)});
    };
    context.registerCommand('editor', (_monitor, path) => {
        context.invoke('launcher.hide');
        const focused = [...windows].find(editor => editor.window.is_active);
        const editor = path ? focused ?? [...windows].at(-1) ?? open() : open();
        editor.show(); if (path) void editor.openFile(path);
    });
    const unsubscribe = context.preferences.subscribe(() => { windows.forEach(editor => editor.applyPreferences()); });
    return () => { unsubscribe(); for (const editor of [...windows]) editor.destroy(); void assets?.then(server => server.dispose()).catch(() => {}); };
}} satisfies UIExtension;
