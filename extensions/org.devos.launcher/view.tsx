import {
    Gtk, Gdk, Pango, type GioTypes as Gio, React,
    Box, Label, Button, Image, SearchEntry,
    ScrolledWindow, ListBox, ListBoxRow, createRoot, flushSync,
    useState, useMemo, useRef, useLayoutEffect, useImperativeHandle
} from '@dev-os/core';

export interface LauncherServices {
    display: Gdk.Display;
    runCommand(command: 'terminal' | 'files' | 'lock'): boolean;
    quit(): void;
    installedApps(): Gio.AppInfo[];
    searchApps(apps: Gio.AppInfo[], query: string): Gio.AppInfo[];
    showSettings?(): void;
    openEditor?(): void;
}
interface LauncherHandle {
    show(): void;
    hide(): boolean;
    showMessage(message: string): void;
    requestLogout(): void;
    onKey(event: Gdk.Event): boolean;
}
interface ViewProps {window: Gtk.ApplicationWindow; services: LauncherServices; handle: React.Ref<LauncherHandle>;}

function LauncherView({window, services, handle}: ViewProps) {
    const [apps, setApps] = useState(services.installedApps);
    const [query, setQuery] = useState('');
    const [visible, setVisible] = useState(false);
    const [confirmLogout, setConfirmLogout] = useState(false);
    const [message, setMessage] = useState('');
    const search = useRef<Gtk.SearchEntry>(null), rows = useRef<Gtk.ListBox>(null);
    const matches = useMemo(() => services.searchApps(apps, query), [apps, query, services]);
    const hide = () => { setVisible(false); setConfirmLogout(false); return true; };
    const launch = (app?: Gio.AppInfo) => {
        if (!app) return;
        try { app.launch([], services.display.get_app_launch_context()); hide(); }
        catch (error) { setMessage(`Could not open ${app.get_display_name()}: ${error instanceof Error ? error.message : String(error)}`); }
    };
    const launchSelected = () => {
        const selected = rows.current?.get_selected_row();
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
    }, [matches, visible]);
    useLayoutEffect(() => {
        if (visible) { window.show(); search.current?.grab_focus(); }
        else window.hide();
    }, [visible, window]);
    useImperativeHandle(handle, () => ({
        show() { setApps(services.installedApps()); setQuery(''); setMessage(''); setConfirmLogout(false); setVisible(true); },
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
    return <Box orientation="vertical">
        <Box className="launcher-body" orientation="vertical" spacing={12} borderWidth={20} expand fill>
            <Box spacing={12}>
                <Box className="launcher-brand" widthRequest={36} heightRequest={36} valign="center">
                    <Image iconName="view-app-grid-symbolic" pixelSize={20} expand />
                </Box>
                <Box orientation="vertical" spacing={1} expand>
                    <Label className="launcher-eyebrow" xalign={0}>DEV OS</Label>
                    <Label className="heading" xalign={0}>Applications</Label>
                </Box>
                <Button id="launcher-close" className="launcher-icon-button" tooltip="Close menu · Esc" valign="center" onClicked={hide}>
                    <Image iconName="window-close-symbolic" pixelSize={16} />
                </Button>
            </Box>
            <SearchEntry id="launcher-search" ref={search} text={query} placeholder="Search apps by name or keyword…"
                onChanged={entry => { setQuery(entry.get_text()); setMessage(''); }} onActivate={launchSelected} />
            <Box orientation="vertical" spacing={8}>
                <Label className="launcher-section" xalign={0}>WORKSPACE</Label>
                <Box spacing={8} homogeneous>
                    {(['terminal', 'files'] as const).map(command => <Button key={command} id={`launcher-${command}`}
                        className={`launcher-shortcut shortcut-${command}`} expand fill
                        onClicked={() => { if (services.runCommand(command)) hide(); else setMessage(`Could not open ${command}`); }}>
                        <Box spacing={10}>
                            <Image iconName={command === 'terminal' ? 'utilities-terminal' : 'system-file-manager'} pixelSize={28} />
                            <Box orientation="vertical" spacing={3} expand>
                                <Label className="shortcut-title" xalign={0}>{command === 'terminal' ? 'Terminal' : 'Files'}</Label>
                                <Label className="shortcut-detail" xalign={0}>{command === 'terminal' ? 'Run commands' : 'Your workspace'}</Label>
                            </Box>
                        </Box>
                    </Button>)}
                    {services.openEditor && <Button id="launcher-editor" className="launcher-shortcut shortcut-editor" expand fill
                        onClicked={() => { hide(); services.openEditor?.(); }}>
                        <Box spacing={10}>
                            <Image iconName="dev-os-editor" pixelSize={28} />
                            <Box orientation="vertical" spacing={3} expand>
                                <Label className="shortcut-title" xalign={0}>Editor</Label>
                                <Label className="shortcut-detail" xalign={0}>Write code</Label>
                            </Box>
                        </Box>
                    </Button>}
                </Box>
            </Box>
            <Box orientation="vertical" spacing={8} expand fill>
                <Box spacing={8}>
                    <Label className="launcher-section" xalign={0} expand>{query.trim() ? 'SEARCH RESULTS' : 'ALL APPLICATIONS'}</Label>
                    <Label className="launcher-count">{`${matches.length} ${matches.length === 1 ? 'app' : 'apps'}`}</Label>
                </Box>
                <ScrolledWindow className="launcher-apps" visible={matches.length > 0} expand fill minContentHeight={240}
                    hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                    <ListBox ref={rows} selectionMode={Gtk.SelectionMode.SINGLE} activateOnSingleClick
                        onRowActivated={(_list, row) => launch(matches[row.get_index()])}>
                        {matches.map((app, index) => <ListBoxRow key={app.get_id() ?? `${app.get_display_name()}-${index}`}>
                            <Box spacing={12} borderWidth={8}>
                                <Box className="launcher-app-icon" widthRequest={38} heightRequest={38} valign="center">
                                    <Image gicon={app.get_icon()} iconName="application-x-executable"
                                        iconSize={Gtk.IconSize.DIALOG} pixelSize={28} expand />
                                </Box>
                                <Box orientation="vertical" spacing={3} expand valign="center">
                                    <Label className="launcher-app-name" xalign={0} ellipsize={Pango.EllipsizeMode.END}>{app.get_display_name()}</Label>
                                    <Label className="launcher-app-description" xalign={0} ellipsize={Pango.EllipsizeMode.END}>
                                        {app.get_description() || app.get_id() || 'Desktop application'}
                                    </Label>
                                </Box>
                                <Image className="launcher-row-arrow" iconName="go-next-symbolic" pixelSize={12} />
                            </Box>
                        </ListBoxRow>)}
                    </ListBox>
                </ScrolledWindow>
                {!matches.length && <Box className="launcher-empty" orientation="vertical" expand fill heightRequest={240}>
                    <Box orientation="vertical" spacing={8} pack="center">
                        <Image iconName="edit-find-symbolic" pixelSize={28} />
                        <Label className="launcher-app-name">No applications found</Label>
                        <Label className="launcher-app-description">Try another name or keyword.</Label>
                    </Box>
                </Box>}
            </Box>
            <Label className={message ? 'launcher-message' : 'launcher-hint'} xalign={0} wrap maxWidthChars={60}>
                {message || '↑ ↓  Navigate     Enter  Open     Esc  Close'}
            </Label>
        </Box>
        <Box className="launcher-footer" spacing={8}>
            {services.showSettings && <Button id="launcher-settings" onClicked={() => { hide(); services.showSettings?.(); }}>
                <Box spacing={7}><Image iconName="preferences-system-symbolic" pixelSize={16} /><Label>Settings</Label></Box>
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

export function mountLauncher(window: Gtk.ApplicationWindow, services: LauncherServices) {
    const root = createRoot(window), handle = React.createRef<LauncherHandle>();
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
