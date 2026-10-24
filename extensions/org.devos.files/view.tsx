import {
    Gtk, Gdk, GLib, Gio, Pango,
    React, Box, Label, Button, Image, Overlay,
    Entry, CheckButton, ScrolledWindow, ListBox, ListBoxRow,
    FlowBox, FlowBoxChild, createRoot, mountWindowHeader, flushSync,
    useState, useLayoutEffect, useRef, useImperativeHandle, useMemo,
    memo
} from '@dev-os/core';
import type {FileBrowser, FileEntry} from './model.js';
import {fileKind, modifiedLabel, compactPath} from './presentation.js';
import {FileSearch, DEFAULT_SEARCH_EXCLUDES} from './search.js';
import {materialIcon} from '../org.devos.icons/material.js';
import {QuickOpen} from './search-view.js';
import type {QuickOpenHandle} from './search-view.js';
import {fileMenuOptions, createFileContextMenu, fileContextEntry, type FileMenuOptions} from './context-menu.js';
import {runCustomMenuItem} from './custom-menu.js';

export interface BrowserOptions {gridView: boolean; showHidden: boolean; searchExcludedDirectories?: string; materialIcons?: boolean; contextMenu?: FileMenuOptions; openTerminal?(directory: string): void;}
interface ViewHandle {focusAddress(): void; toggleHidden(): void; submitName(): void; setGrid(value: boolean): void; quickOpen(): void; searchKey(key: number, shift: boolean): boolean;}
function entryIcon(entry: {path: string; directory: boolean; icon: Gio.Icon | null}) {
    const material = materialIcon(entry.path, entry.directory);
    return material ? Gio.ThemedIcon.new(material) : entry.icon ?? Gio.ThemedIcon.new(entry.directory ? 'folder' : 'text-x-generic');
}
// Selection and address typing should not recreate icons/labels for every file.
const FileRow = memo(function FileRow({entry, selected}: {entry: FileEntry; selected: boolean}) {
    const kind = fileKind(entry);
    return <ListBoxRow tooltip={entry.label} className={selected ? 'selected-file' : ''}>
        <Box spacing={12} borderWidth={8}>
            <Image gicon={entryIcon(entry)} pixelSize={24} />
            <Label className="file-name" xalign={0} ellipsize={Pango.EllipsizeMode.MIDDLE} maxWidthChars={38} expand>{entry.label}</Label>
            <Label className={`file-type kind-${kind.color}`} xalign={0} widthRequest={76}>{kind.label}</Label>
            <Label className="subtle mono" xalign={1} widthRequest={72}>{entry.directory ? '—' : GLib.format_size(entry.size)}</Label>
            <Label className="subtle mono" xalign={1} widthRequest={90}>{modifiedLabel(entry.modified)}</Label>
        </Box>
    </ListBoxRow>;
});
const FileCard = memo(function FileCard({entry, selected}: {entry: FileEntry; selected: boolean}) {
    const kind = fileKind(entry);
    return <FlowBoxChild valign="start" tooltip={entry.path} className={selected ? 'selected-file' : ''}>
        <Box className="file-card" orientation="vertical" spacing={10} borderWidth={14} widthRequest={126}>
            <Box spacing={12}><Image gicon={entryIcon(entry)} pixelSize={36} expand />
                <Label className={`type-badge kind-${kind.color}`} valign="start">{kind.tag}</Label></Box>
            <Label className="file-name" xalign={0} maxWidthChars={19} ellipsize={Pango.EllipsizeMode.MIDDLE}>{entry.label}</Label>
            <Label className="subtle" xalign={0}>{entry.directory ? kind.label : GLib.format_size(entry.size)}</Label>
        </Box>
    </FlowBoxChild>;
});
function FilesView({model, search, options, handle, copyPath}: {model: FileBrowser; search: FileSearch; options: BrowserOptions; handle: React.Ref<ViewHandle>; copyPath(path: string): void}) {
    const [state, update] = useState(model.state);
    const [grid, setGrid] = useState(options.gridView), [hidden, setHidden] = useState(options.showHidden);
    const [limit, setLimit] = useState(200);
    const [address, setAddress] = useState(state.directory);
    const [editing, setEditing] = useState<'create' | 'rename' | null>(null), [name, setName] = useState('');
    const [notice, setNotice] = useState('');
    const [quick, setQuick] = useState(false);
    const quickHandle = useRef<QuickOpenHandle>(null);
    const addressEntry = useRef<Gtk.Entry>(null);
    const emptyOverlay = useRef<Gtk.Overlay>(null), emptyContent = useRef<Gtk.Box>(null);
    useLayoutEffect(() => { if (emptyOverlay.current && emptyContent.current) emptyOverlay.current.set_overlay_pass_through(emptyContent.current, true); });
    const listWidget = useRef<Gtk.ListBox>(null), gridWidget = useRef<Gtk.FlowBox>(null);
    useLayoutEffect(() => model.subscribe(() => update(model.state)), [model]);
    useLayoutEffect(() => { setGrid(options.gridView); setHidden(options.showHidden); }, [options.gridView, options.showHidden]);
    useLayoutEffect(() => { setAddress(state.directory); setLimit(200); setEditing(null); setNotice(''); }, [state.directory]);
    useLayoutEffect(() => { if (state.busy || state.loading) setNotice(''); }, [state.busy, state.loading]);
    useLayoutEffect(() => {
        if (quick && search.state.root !== state.directory) { search.stop(); setQuick(false); }
    }, [state.directory, quick, search]);
    const closeQuick = () => { search.stop(); setQuick(false); };
    const openQuick = () => {
        if (quick) { quickHandle.current?.focus(); return; }
        void search.start(model.state.directory, {excludedDirectories: (options.searchExcludedDirectories ?? DEFAULT_SEARCH_EXCLUDES).split(',').map(value => value.trim()).filter(Boolean)});
        setQuick(true);
    };
    useImperativeHandle(handle, () => ({focusAddress() { addressEntry.current?.grab_focus(); addressEntry.current?.select_region(0, -1); }, toggleHidden() { setHidden(value => !value); }, submitName() { if (editing) submit(); }, setGrid(value) { setGrid(value); model.select(null); }, quickOpen: openQuick, searchKey: (key, shift) => quick ? quickHandle.current?.key(key, shift) ?? false : false}));
    const filtered = useMemo(() => state.entries.filter(entry => hidden || !entry.hidden), [state.entries, hidden]);
    const entries = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
    const selected = state.entries.find(entry => entry.path === state.selected);
    const open = (index: number) => { const entry = entries[index]; if (entry) void model.open(entry); };
    const rename = () => { if (selected) { setName(selected.name); setEditing('rename'); } };
    const submit = () => { void (editing === 'create' ? model.createFolder(name) : model.rename(name)).then(ok => { if (ok) setEditing(null); }); };
    useLayoutEffect(() => {
        const widget = grid ? gridWidget.current : listWidget.current;
        if (!widget || quick) return;
        let menu: Gtk.Menu | undefined;
        const gesture = new Gtk.GestureMultiPress({widget, button: 3, propagation_phase: Gtk.PropagationPhase.CAPTURE});
        const signal = gesture.connect('pressed', (_gesture, _count, x, y) => {
            const optionsMenu = options.contextMenu ?? fileMenuOptions();
            if (!optionsMenu.contextEnabled) return;
            const entry = fileContextEntry(widget, x, y, entries);
            // Read this click's target directly; React selection updates may commit later.
            model.select(entry?.path ?? null);
            const current = model.state, busy = current.loading || current.busy;
            menu?.destroy();
            menu = createFileContextMenu(optionsMenu, {
                contextOpen: () => {if (entry) void model.open(entry);},
                contextRename: () => {if (entry) {setName(entry.name); setEditing('rename');}},
                contextCopyPath: () => {copyPath(entry?.path ?? current.directory); setNotice('Path copied');},
                contextNewFolder: () => {setName(''); setEditing('create');},
                contextTerminal: options.openTerminal ? () => options.openTerminal!(entry?.directory ? entry.path : current.directory) : undefined,
                contextRefresh: () => {void model.refresh();},
                contextHidden: () => {setHidden(value => !value); model.select(null);},
            }, Boolean(entry), busy, hidden, {target: entry ? entry.directory ? 'folder' : 'file' : 'background',
                activate: item => runCustomMenuItem(item, entry?.path ?? current.directory, current.directory, message => setNotice(message))});
            if (!menu.get_children().length) return;
            menu.show_all();
            const event = gesture.get_last_event(gesture.get_current_sequence());
            menu.popup_at_pointer(event);
            gesture.set_state(Gtk.EventSequenceState.CLAIMED);
        });
        return () => {gesture.disconnect(signal); gesture.run_dispose(); menu?.destroy();};
    }, [grid, quick, entries, options.contextMenu, options.openTerminal, hidden]);
    const breadcrumbs = [{label: 'File system', path: '/'}];
    let path = '';
    for (const part of state.directory.split('/').filter(Boolean)) { path += `/${part}`; breadcrumbs.push({label: part, path}); }
    const places = [['Home', GLib.get_home_dir()], ['Documents', GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS)],
        ['Downloads', GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD)], ['File system', '/']];
    const folders = useMemo(() => filtered.filter(entry => entry.directory).slice(0, 8), [filtered]);
    return <Box orientation="vertical" spacing={0} expand vexpand>
        <Box spacing={0} expand>
            <ScrolledWindow className="files-sidebar" widthRequest={170} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box orientation="vertical" spacing={8} borderWidth={16}>
                <Box className="files-brand" spacing={10} marginBottom={18}><Image iconName="folder-symbolic" pixelSize={24} /><Box orientation="vertical" spacing={3}><Label className="files-brand-title" xalign={0}>Files</Label><Label className="subtle" xalign={0}>Your everyday workspace</Label></Box></Box>
                <Label className="eyebrow" xalign={0} marginBottom={6}>PLACES</Label>
                {places.filter((place): place is string[] => !!place[1]).map(([label, path]) => <Button key={label}
                    className={`place-button ${state.directory === path ? 'place-active' : ''}`} tooltip={path} onClicked={() => { void model.navigate(path); }}>
                    <Box spacing={10}><Image iconName={label === 'Home' ? 'user-home-symbolic' : label === 'File system' ? 'drive-harddisk-symbolic' : 'folder-symbolic'} pixelSize={16} /><Label xalign={0} expand>{label}</Label></Box>
                </Button>)}
                <Label className="eyebrow" xalign={0} marginTop={22} marginBottom={4}>FOLDERS HERE</Label>
                {folders.map(entry => <Button key={entry.path} className="folder-shortcut" tooltip={entry.path} onClicked={() => { void model.navigate(entry.path); }}>
                    <Box spacing={8}><Image iconName={materialIcon(entry.path, true) ?? 'folder-symbolic'} pixelSize={14} /><Label className="mono" xalign={0} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={19} expand>{entry.name}</Label></Box>
                </Button>)}
                {!folders.length && <Label className="subtle" xalign={0}>No subfolders</Label>}
                <Box orientation="vertical" expand />
                <CheckButton active={hidden} onToggled={button => { setHidden(button.active); model.select(null); }}>Hidden files</CheckButton>
                <Box className="shortcut-note" orientation="vertical" spacing={5} marginTop={10}>
                    <Label className="subtle" xalign={0}>QUICK NAVIGATION</Label>
                    <Label className="mono subtle" xalign={0}>Ctrl L     Folder path</Label>
                    <Label className="mono subtle" xalign={0}>Alt ←      Go back</Label>
                </Box>
            </Box>
            </ScrolledWindow>
            {quick ? <QuickOpen search={search} handle={quickHandle} close={closeQuick} accept={(file, reveal) => {
                closeQuick();
                if (reveal) {
                    const parent = Gio.File.new_for_path(file.path).get_parent()?.get_path();
                    if (parent) void model.navigate(parent).then(ok => { if (ok) model.select(file.path); });
                } else void model.openPath(file.path);
            }} /> : <Box orientation="vertical" spacing={12} borderWidth={20} expand>
                <Box className="location-bar" spacing={4}>
            <Button tooltip="Back · Alt + Left" sensitive={state.back && !state.loading} onClicked={() => { void model.back(); }}><Image iconName="go-previous-symbolic" pixelSize={16} /></Button>
            <Button tooltip="Forward · Alt + Right" sensitive={state.forward && !state.loading} onClicked={() => { void model.forward(); }}><Image iconName="go-next-symbolic" pixelSize={16} /></Button>
            <Button tooltip="Parent folder" sensitive={state.directory !== '/' && !state.loading} onClicked={() => { void model.up(); }}><Image iconName="go-up-symbolic" pixelSize={16} /></Button>
            <Entry id="files-location" className="mono" ref={addressEntry} text={address} expand placeholder="Folder path · Ctrl + L" widthChars={16}
                onChanged={entry => setAddress(entry.get_text())} onActivate={() => { void model.navigate(address); }} />

            <Button tooltip="Refresh · F5" onClicked={() => { void model.refresh(); }}><Image iconName="view-refresh-symbolic" pixelSize={16} /></Button>
                </Box>
        <ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vscrollbarPolicy={Gtk.PolicyType.NEVER}>
            <Box className="breadcrumbs" spacing={3}>{breadcrumbs.map(item => <Button key={item.path} className={item.path === state.directory ? 'crumb-current' : ''} tooltip={item.path} onClicked={() => { void model.navigate(item.path); }}>{item.label}</Button>)}</Box>
        </ScrolledWindow>
                <Box className="folder-heading" spacing={12} marginTop={6} marginBottom={4}>
                    <Box className="folder-emblem" borderWidth={12}><Image iconName={state.directory === GLib.get_home_dir() ? 'user-home-symbolic' : 'folder-symbolic'} pixelSize={26} /></Box>
                    <Box orientation="vertical" spacing={5} expand>
                        <Label className="folder-title" xalign={0} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={24}>{state.directory === GLib.get_home_dir() ? 'Home' : state.directory === '/' ? 'File system' : GLib.path_get_basename(state.directory)}</Label>
                        <Label className="subtle" xalign={0}>{filtered.length ? `${filtered.length} items in this folder` : 'A little space for something new'}</Label>
                    </Box>
                    <Button className="files-icon-button" tooltip="Search files · Ctrl + P" onClicked={openQuick}><Image iconName="system-search-symbolic" pixelSize={18} /></Button>
                </Box>
                <Box className="files-actions" spacing={6}>
                    <Button className="primary-action" sensitive={!state.loading && !state.busy} onClicked={() => { setName(''); setEditing('create'); }}><Box spacing={6}><Image iconName="folder-new-symbolic" pixelSize={16} /><Label>New folder</Label></Box></Button>
                    <Button tooltip="Rename selected item" sensitive={!!selected && !state.busy && !state.loading} onClicked={rename}><Image iconName="document-edit-symbolic" pixelSize={16} /></Button>
                    <Button tooltip="Open selected item" sensitive={!!selected && !state.busy} onClicked={() => { if (selected) void model.open(selected); }}><Image iconName="document-open-symbolic" pixelSize={16} /></Button>
                    <Button tooltip="Copy selected item path, or current folder path" onClicked={() => { copyPath(selected?.path ?? state.directory); setNotice('Path copied'); }}><Image iconName="edit-copy-symbolic" pixelSize={16} /></Button>
                    <Box expand />
                    <Button className={!grid ? 'view-active' : ''} tooltip="List view" onClicked={() => { setGrid(false); model.select(null); }}><Image iconName="view-list-symbolic" pixelSize={16} /></Button>
                    <Button className={grid ? 'view-active' : ''} tooltip="Grid view" onClicked={() => { setGrid(true); model.select(null); }}><Image iconName="view-grid-symbolic" pixelSize={16} /></Button>
                </Box>
                {editing && <Box className="edit-strip" spacing={8} borderWidth={8}>
                    <Entry id="files-name" expand text={name} placeholder={editing === 'create' ? 'New folder name' : 'New name'}
                        onChanged={entry => setName(entry.get_text())} onActivate={submit} sensitive={!state.busy} />
                    <Button sensitive={!state.busy && !!name.trim()} onClicked={submit}>{editing === 'create' ? 'Create' : 'Save name'}</Button>
                    <Button sensitive={!state.busy} onClicked={() => setEditing(null)}>Cancel</Button>
                </Box>}
                {state.error && <Label className="error" xalign={0} wrap>{state.error}</Label>}
                {state.loading && <Label className="muted" xalign={0}>Loading folder…</Label>}
                {!grid && <Box className="column-heading" spacing={12} marginStart={12} marginEnd={12}>
                    <Label xalign={0} expand>NAME</Label><Label xalign={0} widthRequest={76}>TYPE</Label>
                    <Label xalign={1} widthRequest={72}>SIZE</Label><Label xalign={1} widthRequest={90}>MODIFIED</Label>
                </Box>}
                <Overlay ref={emptyOverlay} className="files-content" expand vexpand>
                <ScrolledWindow expand hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                    {grid ? <FlowBox id="files-grid" ref={gridWidget} selectionMode={Gtk.SelectionMode.SINGLE} activateOnSingleClick={false}
                        minChildrenPerLine={1} maxChildrenPerLine={6} rowSpacing={8} columnSpacing={8}
                        onChildActivated={(_box, child) => open(child.get_index())}
                        onSelectedChildrenChanged={box => model.select(entries[box.get_selected_children()[0]?.get_index()]?.path ?? null)}>
                        {entries.map(entry => <FileCard key={entry.path} entry={entry} selected={state.selected === entry.path} />)}
                    </FlowBox> : <ListBox id="files-list" ref={listWidget} selectionMode={Gtk.SelectionMode.SINGLE} activateOnSingleClick={false}
                        onRowSelected={(_list, row) => model.select(row ? entries[row.get_index()]?.path ?? null : null)}
                        onRowActivated={(_list, row) => open(row.get_index())}>
                        {entries.map(entry => <FileRow key={entry.path} entry={entry} selected={state.selected === entry.path} />)}
                    </ListBox>}
                </ScrolledWindow>
                {!state.loading && !filtered.length && <Box ref={emptyContent} overlay orientation="vertical" halign="center" valign="center" spacing={12} className="files-empty">
                    <Box className="empty-folder-icon" halign="center" borderWidth={24}><Image iconName="folder-symbolic" pixelSize={52} /></Box>
                    <Label className="empty-title">A fresh start</Label>
                    <Label className="subtle">This folder is empty</Label>
                    <Label className="subtle" marginTop={4}>Use New folder to make room for your next idea.</Label>
                </Box>}
                </Overlay>
                {filtered.length > limit && <Button onClicked={() => setLimit(value => value + 200)}>Show more</Button>}
            </Box>}
        </Box>
        <Box id="files-footer" className="files-statusbar" spacing={10} vexpand={false}>
            <Image iconName={selected ? 'text-x-generic-symbolic' : 'folder-symbolic'} pixelSize={14} valign="center" />
            <Label className="footer-location" xalign={0} valign="center" ellipsize={Pango.EllipsizeMode.MIDDLE} expand tooltip={selected?.path ?? state.directory}>{selected?.label ?? (state.directory === GLib.get_home_dir() ? 'Home' : compactPath(state.directory))}</Label>
            {!!(state.busy || notice || state.status) && <Label className="status-message" valign="center" ellipsize={Pango.EllipsizeMode.END} maxWidthChars={24}>{state.busy ? 'Working…' : notice || state.status}</Label>}
            <Label className="footer-count" valign="center">{selected ? '1 selected  ·  ' : ''}{filtered.length} {filtered.length === 1 ? 'item' : 'items'}</Label>
        </Box>
    </Box>;
}
export function mountFiles(window: Gtk.ApplicationWindow, model: FileBrowser, options: BrowserOptions, container?: Gtk.Container) {
    const root = createRoot(container ?? window), handle = React.createRef<ViewHandle>(), search = new FileSearch();
    const display = window.get_display();
    const copyPath = (path: string) => Gtk.Clipboard.get_for_display(display, Gdk.Atom.intern('CLIPBOARD', false)).set_text(path, -1);
    const render = (next: BrowserOptions) => root.render(<FilesView {...{model, search, options: next, handle, copyPath}} />);
    render(options);
    const header = !container ? mountWindowHeader(window, {title: 'Files', iconName: 'folder-symbolic',
        windowIconName: 'system-file-manager', iconId: 'files-window-icon'}) : undefined;
    return {update: render, focusAddress: () => handle.current?.focusAddress(), toggleHidden: () => handle.current?.toggleHidden(), submitName: () => handle.current?.submitName(), setGrid: (value: boolean) => handle.current?.setGrid(value), quickOpen: () => flushSync(() => handle.current?.quickOpen()), searchKey: (key: number, shift = false) => flushSync(() => handle.current?.searchKey(key, shift) ?? false), destroy: () => { search.dispose(); root.unmount(); header?.destroy(); }};
}
