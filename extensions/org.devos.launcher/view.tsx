import {
    Gtk, Gdk, Pango, type GioTypes as Gio, React,
    Box, Label, Button, Image, SearchEntry,
    ScrolledWindow, ListBox, ListBoxRow, FlowBox, FlowBoxChild, createRoot, flushSync, type SettingsValues,
    useState, useMemo, useRef, useLayoutEffect, useImperativeHandle
} from '@dev-os/core';
import {DEFAULT_LAUNCHER_OPTIONS, type LauncherOptions} from './options.js';
import {launcherCustomization, workspaceAppKey} from './customization.js';
import type {OverlayMotion} from './overlay-motion.js';
import {launchDesktopApp} from '@dev-os/services/apps';

export interface LauncherServices {
    motion?: OverlayMotion;
    options?: LauncherOptions;
    display: Gdk.Display;
    runCommand(command: 'terminal' | 'files' | 'lock'): boolean;
    quit(): void;
    installedApps(): Gio.AppInfo[];
    searchApps(apps: Gio.AppInfo[], query: string): Gio.AppInfo[];
    showSettings?(): void;
    openEditor?(): void;
    getCustomization?(): SettingsValues;
    saveCustomization?(patch: SettingsValues): void;
}
interface LauncherHandle {
    show(): void;
    hide(): boolean;
    showMessage(message: string): void;
    requestLogout(): void;
    onKey(event: Gdk.Event): boolean;
}
interface ViewProps {window: Gtk.Window; services: LauncherServices; handle: React.Ref<LauncherHandle>;}

function LauncherView({window, services, handle}: ViewProps) {
    const options = services.options ?? DEFAULT_LAUNCHER_OPTIONS;
    const [apps, setApps] = useState(services.installedApps);
    const [query, setQuery] = useState('');
    const [visible, setVisible] = useState(false);
    const [confirmLogout, setConfirmLogout] = useState(false);
    const [message, setMessage] = useState('');
    const [customization, setCustomization] = useState(() => launcherCustomization(services.getCustomization?.()));
    const [editingWorkspace, setEditingWorkspace] = useState(false);
    const grid = useRef<Gtk.FlowBox>(null);
    const save = (patch: SettingsValues) => {
        try {
            services.saveCustomization?.(patch);
            setCustomization(current => launcherCustomization({appView: current.appView, workspaceApps: JSON.stringify(current.workspaceApps), ...patch}));
            setMessage('');
        } catch (error) {setMessage(`Could not save launcher: ${String(error)}`);}
    };
    const pin = (key: string) => {
        if (!customization.workspaceApps.includes(key) && customization.workspaceApps.length >= 64) {setMessage('Workspace supports up to 64 apps. Remove one before adding another.'); return;}
        save({workspaceApps: JSON.stringify(customization.workspaceApps.includes(key) ? customization.workspaceApps.filter(item => item !== key) : [...customization.workspaceApps, key])});
    };
    const search = useRef<Gtk.SearchEntry>(null), rows = useRef<Gtk.ListBox>(null);
    useLayoutEffect(() => {
        const size = () => search.current?.set_size_request(Math.min(options.menuWidth, Math.max(1, window.get_allocated_width() - 48)), -1);
        const signal = window.connect('size-allocate', size); size();
        return () => window.disconnect(signal);
    }, [window, options.menuWidth]);
    const matches = useMemo(() => services.searchApps(apps, query), [apps, query, services]);
    const hide = () => { setVisible(false); setConfirmLogout(false); return true; };
    const launch = (app?: Gio.AppInfo) => {
        if (!app) return;
        void launchDesktopApp(app, services.display.get_app_launch_context()).then(hide)
            .catch(error => setMessage(`Could not open ${app.get_display_name()}: ${String(error)}`));
    };
    const launchSelected = () => {
        const selected = customization.appView === 'grid' ? grid.current?.get_selected_children()[0] : rows.current?.get_selected_row();
        if (selected) launch(matches[selected.get_index()]);
    };
    const requestLogout = () => {
        if (confirmLogout) services.quit();
        else {
            setConfirmLogout(true);
            setMessage('Save your work, then click Confirm log out to end this session.');
        }
    };
    useLayoutEffect(() => {
        rows.current?.select_row(rows.current.get_row_at_index(0));
        grid.current?.set_homogeneous(true);
        const first = grid.current?.get_child_at_index(0); if (first) grid.current?.select_child(first);
    }, [matches, visible, customization.appView]);
    useLayoutEffect(() => {
        if (visible) { if (services.motion) services.motion.show(); else window.show(); search.current?.grab_focus(); }
        else if (services.motion) services.motion.hide(); else window.hide();
    }, [visible, window]);
    useImperativeHandle(handle, () => ({
        show() { setApps(services.installedApps()); if (services.getCustomization) setCustomization(launcherCustomization(services.getCustomization())); if (!options.rememberSearch) setQuery(''); setMessage(''); setEditingWorkspace(false); setConfirmLogout(false); setVisible(true); },
        hide, showMessage: setMessage, requestLogout,
        onKey(event) {
            const [, key] = event.get_keyval();
            if (key === Gdk.KEY_Escape) return hide();
            if ([Gdk.KEY_Return, Gdk.KEY_KP_Enter].includes(key)) {
                const focus = window.get_focus();
                if (focus instanceof Gtk.Button) focus.clicked();
                else launchSelected();
                return true;
            }
            if (customization.appView === 'grid' && [Gdk.KEY_Up, Gdk.KEY_Down, Gdk.KEY_Left, Gdk.KEY_Right].includes(key)) {
                if ([Gdk.KEY_Left, Gdk.KEY_Right].includes(key) && window.get_focus() instanceof Gtk.Entry) return false;
                const children = grid.current?.get_children() as Gtk.FlowBoxChild[] | undefined;
                if (!children?.length) return true;
                const selected = grid.current?.get_selected_children()[0];
                const firstY = children[0].get_allocation().y;
                const columns = children.filter(child => child.get_allocation().y === firstY).length || 1;
                const offset = key === Gdk.KEY_Up ? -columns : key === Gdk.KEY_Down ? columns : key === Gdk.KEY_Left ? -1 : 1;
                const next = children[Math.max(0, Math.min(children.length - 1, (selected?.get_index() ?? 0) + offset))];
                grid.current?.select_child(next); next.grab_focus(); return true;
            }
            if ([Gdk.KEY_Up, Gdk.KEY_Down].includes(key)) {
                const current = rows.current?.get_selected_row();
                const index = Math.max(0, (current?.get_index() ?? -1) + (key === Gdk.KEY_Down ? 1 : -1));
                const row = rows.current?.get_row_at_index(index);
                if (row) { rows.current?.select_row(row); row.grab_focus(); }
                return true;
            }
            return false;
        },
    }));
    return <Box orientation="vertical" expand fill hexpand vexpand>
        <Box className="launcher-body" orientation="vertical" spacing={12} borderWidth={20} expand fill>
            <Box spacing={12}>
                <Box className="launcher-brand" widthRequest={36} heightRequest={36} valign="center">
                    <Image iconName="dev-os-symbolic" pixelSize={20} expand />
                </Box>
                <Box orientation="vertical" spacing={1} expand>
                    <Label className="launcher-eyebrow" xalign={0}>DEV OS</Label>
                    <Label className="heading" xalign={0}>Applications</Label>
                </Box>
                <Button id="launcher-close" className="launcher-icon-button" tooltip="Close menu · Esc" valign="center" onClicked={hide}>
                    <Image iconName="window-close-symbolic" pixelSize={16} />
                </Button>
            </Box>
            <SearchEntry id="launcher-search" ref={search} halign="center" text={query} placeholder="Search apps by name or keyword…"
                onChanged={entry => { setQuery(entry.get_text()); setMessage(''); }} onActivate={launchSelected} />
            {options.showWorkspace && <Box orientation="vertical" spacing={8}>
                <Box spacing={8}><Label className="launcher-section" xalign={0} expand>WORKSPACE</Label><Button id="launcher-workspace-edit" onClicked={() => setEditingWorkspace(!editingWorkspace)}>{editingWorkspace ? 'Done' : 'Edit workspace'}</Button><Button id="launcher-workspace-add" onClicked={() => {setEditingWorkspace(true); search.current?.grab_focus();}}>Add apps</Button></Box>
                <ScrolledWindow minContentHeight={72} hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vscrollbarPolicy={Gtk.PolicyType.NEVER}>
                    <Box spacing={8}>
                        {customization.workspaceApps.map(key => {
                            const builtin = key.startsWith('builtin:') ? key.slice(8) : '';
                            if (builtin === 'editor' && !services.openEditor) return null;
                            const app = apps.find(item => workspaceAppKey(item) === key);
                            const title = builtin === 'terminal' ? 'Terminal' : builtin === 'files' ? 'Files' : builtin === 'editor' ? 'Editor' : app?.get_display_name() ?? 'Unavailable app';
                            const icon = builtin === 'terminal' ? 'dev-os-terminal' : builtin === 'files' ? 'dev-os-files' : builtin === 'editor' ? 'dev-os-editor' : 'application-x-executable';
                            return <Box key={key} className="launcher-workspace-item" spacing={4}>
                                <Button id={builtin ? `launcher-${builtin}` : `launcher-workspace-${key}`} className="launcher-shortcut" sensitive={Boolean(builtin || app)} widthRequest={180} onClicked={() => {
                                    if (builtin === 'editor') {hide(); services.openEditor?.();}
                                    else if (builtin === 'terminal' || builtin === 'files') {if (services.runCommand(builtin)) hide(); else setMessage(`Could not open ${builtin}`);}
                                    else launch(app);
                                }}><Box spacing={10}><Image gicon={app?.get_icon()} iconName={icon} pixelSize={28} /><Label className="shortcut-title" xalign={0} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={20}>{title}</Label></Box></Button>
                                {editingWorkspace && <Button id={`launcher-workspace-remove-${key}`} tooltip={`Remove ${title} from Workspace`} onClicked={() => pin(key)}>×</Button>}
                            </Box>;
                        })}
                        {!customization.workspaceApps.length && <Label className="launcher-app-description">No shortcuts yet. Choose Add apps to pin an application.</Label>}
                    </Box>
                </ScrolledWindow>
                {editingWorkspace && <Label className="launcher-hint" xalign={0}>Use + beside an app below to add it. Removing a shortcut keeps the app installed.</Label>}
            </Box>}
            <Box orientation="vertical" spacing={8} expand fill>
                <Box spacing={8}>
                    <Label className="launcher-section" xalign={0} expand>{query.trim() ? 'SEARCH RESULTS' : 'ALL APPLICATIONS'}</Label>
                    <Label className="launcher-count">{`${matches.length} ${matches.length === 1 ? 'app' : 'apps'}`}</Label>
                    <Button id="launcher-view-list" tooltip="List view" className={customization.appView === 'list' ? 'launcher-view-selected' : ''} onClicked={() => save({appView: 'list'})}><Image iconName="view-list-symbolic" pixelSize={16} /></Button>
                    <Button id="launcher-view-grid" tooltip="Grid view" className={customization.appView === 'grid' ? 'launcher-view-selected' : ''} onClicked={() => save({appView: 'grid'})}><Image iconName="view-grid-symbolic" pixelSize={16} /></Button>
                </Box>
                <ScrolledWindow className="launcher-apps" visible={matches.length > 0} expand fill minContentHeight={120}
                    hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                    {customization.appView === 'list' ? <ListBox ref={rows} selectionMode={Gtk.SelectionMode.SINGLE} activateOnSingleClick
                        onRowActivated={(_list, row) => launch(matches[row.get_index()])}>
                        {matches.map((app, index) => <ListBoxRow key={app.get_id() ?? `${app.get_display_name()}-${index}`}>
                            <Box spacing={12} borderWidth={options.compactRows ? 4 : 8}>
                                <Box className="launcher-app-icon" widthRequest={options.iconSize + (options.compactRows ? 6 : 10)} heightRequest={options.iconSize + (options.compactRows ? 6 : 10)} valign="center">
                                    <Image gicon={app.get_icon()} iconName="application-x-executable"
                                        iconSize={Gtk.IconSize.DIALOG} pixelSize={options.iconSize} expand />
                                </Box>
                                <Box orientation="vertical" spacing={3} expand valign="center">
                                    <Label className="launcher-app-name" xalign={0} ellipsize={Pango.EllipsizeMode.END}>{app.get_display_name()}</Label>
                                    {options.showDescriptions && <Label className="launcher-app-description" xalign={0} ellipsize={Pango.EllipsizeMode.END}>
                                        {app.get_description() || app.get_id() || 'Desktop application'}
                                    </Label>}
                                </Box>
                                {editingWorkspace ? <Button id={`launcher-pin-${index}`} tooltip={customization.workspaceApps.includes(workspaceAppKey(app)) ? 'Remove from Workspace' : 'Add to Workspace'} onClicked={() => pin(workspaceAppKey(app))}>{customization.workspaceApps.includes(workspaceAppKey(app)) ? '−' : '+'}</Button> : <Image className="launcher-row-arrow" iconName="go-next-symbolic" pixelSize={12} />}
                            </Box>
                        </ListBoxRow>)}
                    </ListBox> : <FlowBox ref={grid} id="launcher-app-grid" selectionMode={Gtk.SelectionMode.SINGLE} activateOnSingleClick minChildrenPerLine={1} maxChildrenPerLine={8} rowSpacing={12} columnSpacing={12} valign="start" onChildActivated={(_box, child) => launch(matches[child.get_index()])}>
                        {matches.map((app, index) => <FlowBoxChild key={app.get_id() ?? `${app.get_display_name()}-${index}`}>
                            <Box className="launcher-app-tile" orientation="vertical" spacing={10} widthRequest={130} borderWidth={12}>
                                <Image gicon={app.get_icon()} iconName="application-x-executable" pixelSize={options.iconSize + 16} />
                                <Label className="launcher-app-name" ellipsize={Pango.EllipsizeMode.END} maxWidthChars={18}>{app.get_display_name()}</Label>
                                {options.showDescriptions && <Label className="launcher-app-description" ellipsize={Pango.EllipsizeMode.END} maxWidthChars={18}>{app.get_description() || 'Desktop application'}</Label>}
                                {editingWorkspace && <Button id={`launcher-pin-${index}`} tooltip={customization.workspaceApps.includes(workspaceAppKey(app)) ? 'Remove from Workspace' : 'Add to Workspace'} onClicked={() => pin(workspaceAppKey(app))}>{customization.workspaceApps.includes(workspaceAppKey(app)) ? 'Remove shortcut' : 'Add to Workspace'}</Button>}
                            </Box>
                        </FlowBoxChild>)}
                    </FlowBox>}
                </ScrolledWindow>
                {!matches.length && <Box className="launcher-empty" orientation="vertical" expand fill heightRequest={120}>
                    <Box orientation="vertical" spacing={8} pack="center">
                        <Image iconName="edit-find-symbolic" pixelSize={28} />
                        <Label className="launcher-app-name">No applications found</Label>
                        <Label className="launcher-app-description">Try another name or keyword.</Label>
                    </Box>
                </Box>}
            </Box>
            <Label className={message ? 'launcher-message' : 'launcher-hint'} xalign={0} wrap maxWidthChars={60}>
                {message || `${customization.appView === 'grid' ? '← ↑ ↓ →' : '↑ ↓'}  Navigate     Enter  Open     Esc  Close`}
            </Label>
        </Box>
        <Box className="launcher-footer" spacing={8}>
            {services.showSettings && <Button id="launcher-settings" onClicked={() => { hide(); services.showSettings?.(); }}>
                <Box spacing={7}><Image iconName="dev-os-settings-symbolic" pixelSize={16} /><Label>Settings</Label></Box>
            </Button>}
            <Button id="launcher-lock" tooltip="Lock this session" onClicked={() => {
                if (services.runCommand('lock')) hide(); else setMessage('Could not lock this session');
            }}>
                <Box spacing={7}><Image iconName="system-lock-screen-symbolic" pixelSize={16} /><Label>Lock</Label></Box>
            </Button>
            <Button className={confirmLogout ? 'launcher-logout logout-confirm' : 'launcher-logout'} pack="end"
                onClicked={requestLogout}>{confirmLogout ? 'Confirm log out' : 'Log out'}</Button>
        </Box>
    </Box>;
}

export function mountLauncher(window: Gtk.Window, services: LauncherServices) {
    const root = createRoot(services.motion?.content ?? window), handle = React.createRef<LauncherHandle>();
    root.render(<LauncherView {...{window, services, handle}} />);
    const invoke = <T,>(callback: (current: LauncherHandle) => T): T => {
        if (!handle.current) throw new Error('Launcher has been unmounted');
        const current = handle.current;
        return flushSync(() => callback(current));
    };
    return {
        show: () => invoke(current => current.show()),
        hide: () => invoke(current => current.hide()),
        showMessage: (message: string) => invoke(current => current.showMessage(message)),
        requestLogout: () => invoke(current => current.requestLogout()),
        onKey: (event: Gdk.Event) => invoke(current => current.onKey(event)),
        destroy: () => root.unmount(),
    };
}
