import {Gtk, Gdk, GLib, Gio, Pango} from '../../src/gtk.js';
import {React, Box, Label, Button, Image, Entry, CheckButton, ScrolledWindow,
    ListBox, ListBoxRow, FlowBox, FlowBoxChild, createRoot, mountWindowHeader, flushSync, useState, useLayoutEffect, useRef, useImperativeHandle} from '@dev-os/react-gtk';
import type {FileBrowser} from './model.js';
import {fileKind, modifiedLabel, compactPath} from './presentation.js';
import {FileSearch, DEFAULT_SEARCH_EXCLUDES} from './search.js';
import {QuickOpen} from './search-view.js';
import type {QuickOpenHandle} from './search-view.js';

export interface BrowserOptions {gridView: boolean; showHidden: boolean; searchExcludedDirectories?: string;}
interface ViewHandle {focusAddress(): void; toggleHidden(): void; submitName(): void; setGrid(value: boolean): void; quickOpen(): void; searchKey(key: number, shift: boolean): boolean;}
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
    const filtered = state.entries.filter(entry => hidden || !entry.hidden);
    const entries = filtered.slice(0, limit), selected = state.entries.find(entry => entry.path === state.selected);
    const open = (index: number) => { const entry = entries[index]; if (entry) void model.open(entry); };
    const rename = () => { if (selected) { setName(selected.name); setEditing('rename'); } };
    const submit = () => { void (editing === 'create' ? model.createFolder(name) : model.rename(name)).then(ok => { if (ok) setEditing(null); }); };
    const breadcrumbs = [{label: 'File system', path: '/'}];
    let path = '';
    for (const part of state.directory.split('/').filter(Boolean)) { path += `/${part}`; breadcrumbs.push({label: part, path}); }
    const places = [['Home', GLib.get_home_dir()], ['Documents', GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS)],
        ['Downloads', GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD)], ['File system', '/']];
    const folders = state.entries.filter(entry => entry.directory && (hidden || !entry.hidden)).slice(0, 8);
    return <Box orientation="vertical" spacing={0} expand vexpand>
        <Box spacing={0} expand>
            <ScrolledWindow className="files-sidebar" widthRequest={180} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box orientation="vertical" spacing={8} borderWidth={16}>
                <Label className="eyebrow" xalign={0} marginBottom={6}>NAVIGATION</Label>
                {places.filter((place): place is string[] => !!place[1]).map(([label, path]) => <Button key={label}
                    className={`place-button ${state.directory === path ? 'place-active' : ''}`} tooltip={path} onClicked={() => { void model.navigate(path); }}>
                    <Box spacing={10}><Image iconName={label === 'Home' ? 'user-home-symbolic' : label === 'File system' ? 'drive-harddisk-symbolic' : 'folder-symbolic'} pixelSize={16} /><Label xalign={0} expand>{label}</Label></Box>
                </Button>)}
                <Label className="eyebrow" xalign={0} marginTop={22} marginBottom={4}>FOLDERS HERE</Label>
                {folders.map(entry => <Button key={entry.path} className="folder-shortcut" tooltip={entry.path} onClicked={() => { void model.navigate(entry.path); }}>
                    <Box spacing={8}><Image iconName="folder-symbolic" pixelSize={14} /><Label className="mono" xalign={0} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={19} expand>{entry.name}</Label></Box>
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
            }} /> : <Box orientation="vertical" spacing={12} borderWidth={18} expand>
                <Box className="location-bar" spacing={4}>
            <Button tooltip="Back · Alt + Left" sensitive={state.back && !state.loading} onClicked={() => { void model.back(); }}>←</Button>
            <Button tooltip="Forward · Alt + Right" sensitive={state.forward && !state.loading} onClicked={() => { void model.forward(); }}>→</Button>
            <Button tooltip="Parent folder" sensitive={state.directory !== '/' && !state.loading} onClicked={() => { void model.up(); }}>↑</Button>
            <Entry id="files-location" className="mono" ref={addressEntry} text={address} expand placeholder="Folder path · Ctrl + L" widthChars={16}
                onChanged={entry => setAddress(entry.get_text())} onActivate={() => { void model.navigate(address); }} />
            <Button onClicked={() => { void model.navigate(address); }}>Go</Button>
            <Button tooltip="Refresh · F5" onClicked={() => { void model.refresh(); }}>Refresh</Button>
                </Box>
        <ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vscrollbarPolicy={Gtk.PolicyType.NEVER}>
            <Box className="breadcrumbs" spacing={3}>{breadcrumbs.map(item => <Button key={item.path} className={item.path === state.directory ? 'crumb-current' : ''} tooltip={item.path} onClicked={() => { void model.navigate(item.path); }}>{item.label}</Button>)}</Box>
        </ScrolledWindow>
                <Box spacing={8}>
                    <Button className="primary-action" sensitive={!state.loading && !state.busy} onClicked={() => { setName(''); setEditing('create'); }}>New folder</Button>
                    <Button sensitive={!!selected && !state.busy && !state.loading} onClicked={rename}>Rename</Button>
                    <Button sensitive={!!selected && !state.busy} onClicked={() => { if (selected) void model.open(selected); }}>Open</Button>
                    <Button tooltip="Copy selected item path, or current folder path" onClicked={() => { copyPath(selected?.path ?? state.directory); setNotice('Path copied'); }}>Copy path</Button>
                    <Box expand />
                    <Button className="view-switch" onClicked={() => { setGrid(value => !value); model.select(null); }}>{grid ? 'List view' : 'Grid view'}</Button>
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
                    <Label xalign={0} expand>NAME</Label><Label xalign={0} widthRequest={106}>TYPE</Label>
                    <Label xalign={1} widthRequest={72}>SIZE</Label><Label xalign={1} widthRequest={110}>MODIFIED</Label>
                </Box>}
                <ScrolledWindow expand hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                    {grid ? <FlowBox id="files-grid" selectionMode={Gtk.SelectionMode.SINGLE} activateOnSingleClick={false}
                        minChildrenPerLine={1} maxChildrenPerLine={6} rowSpacing={8} columnSpacing={8}
                        onChildActivated={(_box, child) => open(child.get_index())}
                        onSelectedChildrenChanged={box => model.select(entries[box.get_selected_children()[0]?.get_index()]?.path ?? null)}>
                        {entries.map(entry => <FlowBoxChild key={entry.path} tooltip={entry.path} className={state.selected === entry.path ? 'selected-file' : ''}>
                            <Box className="file-card" orientation="vertical" spacing={10} borderWidth={14} widthRequest={126}>
                                <Box spacing={12}><Image gicon={entry.icon ?? Gio.ThemedIcon.new(entry.directory ? 'folder' : 'text-x-generic')} pixelSize={36} expand />
                                    <Label className={`type-badge kind-${fileKind(entry).color}`} valign="start">{fileKind(entry).tag}</Label></Box>
                                <Label className="file-name mono" xalign={0} maxWidthChars={19} ellipsize={Pango.EllipsizeMode.MIDDLE}>{entry.label}</Label>
                                <Label className="subtle" xalign={0}>{entry.directory ? fileKind(entry).label : GLib.format_size(entry.size)}</Label>
                            </Box>
                        </FlowBoxChild>)}
                    </FlowBox> : <ListBox id="files-list" selectionMode={Gtk.SelectionMode.SINGLE} activateOnSingleClick={false}
                        onRowSelected={(_list, row) => model.select(row ? entries[row.get_index()]?.path ?? null : null)}
                        onRowActivated={(_list, row) => open(row.get_index())}>
                        {entries.map(entry => <ListBoxRow key={entry.path} tooltip={entry.label} className={state.selected === entry.path ? 'selected-file' : ''}>
                            <Box spacing={12} borderWidth={8}>
                                <Image gicon={entry.icon ?? Gio.ThemedIcon.new('text-x-generic')} pixelSize={20} />
                                <Label className="file-name mono" xalign={0} ellipsize={Pango.EllipsizeMode.MIDDLE} maxWidthChars={38} expand>{entry.label}</Label>
                                <Label className={`file-type kind-${fileKind(entry).color}`} xalign={0} widthRequest={106}>{fileKind(entry).label}</Label>
                                <Label className="subtle mono" xalign={1} widthRequest={72}>{entry.directory ? '—' : GLib.format_size(entry.size)}</Label>
                                <Label className="subtle mono" xalign={1} widthRequest={110}>{modifiedLabel(entry.modified)}</Label>
                            </Box>
                        </ListBoxRow>)}
                    </ListBox>}
                </ScrolledWindow>
                {!state.loading && !filtered.length && <Label className="empty-message">This folder is empty</Label>}
                {filtered.length > limit && <Button onClicked={() => setLimit(value => value + 200)}>Show more</Button>}
            </Box>}
        </Box>
        <Box className="files-statusbar" spacing={12} borderWidth={10}>
            <Label className="status-dot">●</Label>
            <Label className="subtle mono" xalign={0} ellipsize={Pango.EllipsizeMode.MIDDLE} expand tooltip={selected?.path ?? state.directory}>{compactPath(selected?.path ?? state.directory)}</Label>
            <Label className="status-message">{state.busy ? 'Working…' : notice || state.status}</Label>
            <Label className="subtle">{filtered.length} items</Label>
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
