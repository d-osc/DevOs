import {
    React, Box, Label, Button, Image,
    Scale, createRoot, useState, useEffect, useLayoutEffect,
    useRef, Gtk, GLib, Gio, Gdk as NativeGdk,
    type GdkTypes as Gdk, type SettingsHost
} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {clockFormat} from '@dev-os/extensions';
import type {DeviceControls, DeviceState} from './devices.js';
import {windowGroup, type WindowControls, type DesktopWindow, type KeyboardLayout} from '@dev-os/services/windows';
import {findDesktopApp, desktopApps as installedDesktopApps} from '@dev-os/services/apps';
import {panelOptions, type PanelOptions} from './options.js';
import {Accounts, type AccountResult} from '../org.devos.settings/accounts.js';
import {AccountAvatar} from '../org.devos.settings/avatar.js';
import {powerCapabilities, requestPower, type PowerAction} from './power.js';

export function PanelPowerControls() {
    const [available, setAvailable] = useState({sleep: false, restart: false, shutdown: false});
    const [selected, select] = useState<PowerAction | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => {let alive = true; void powerCapabilities().then(value => {if (alive) setAvailable(value);}); return () => {alive = false;};}, []);
    const labels = {sleep: 'Sleep', restart: 'Restart', shutdown: 'Shutdown'};
    const icons = {sleep: 'weather-clear-night-symbolic', restart: 'system-reboot-symbolic', shutdown: 'system-shutdown-symbolic'};
    return <Box orientation="vertical" spacing={8}>
        <Label className="popup-muted" xalign={0}>POWER</Label>
        <Box spacing={6} homogeneous>{(Object.keys(labels) as PowerAction[]).map(action => <Button key={action} id={`panel-power-${action}`} sensitive={available[action] && !busy} tooltip={available[action] ? labels[action] : `${labels[action]} is unavailable on this system`} onClicked={() => {setError(''); select(action);}}><Box orientation="vertical" spacing={6}><Image iconName={icons[action]} pixelSize={18} /><Label>{labels[action]}</Label></Box></Button>)}</Box>
        {selected && <Box orientation="vertical" spacing={8}>
            <Label wrap xalign={0}>{selected === 'sleep' ? 'Put this device to sleep?' : `${labels[selected]} this device? Save your work before continuing.`}</Label>
            <Box spacing={8} homogeneous><Button sensitive={!busy} onClicked={() => select(null)}>Cancel</Button><Button id="panel-power-confirm" sensitive={!busy} onClicked={() => {setBusy(true); setError(''); void requestPower(selected).then(() => select(null)).catch(reason => setError(String(reason))).finally(() => setBusy(false));}}>{busy ? 'Please wait…' : labels[selected]}</Button></Box>
        </Box>}
        {!!error && <Label className="error" wrap maxWidthChars={38} xalign={0}>{error}</Label>}
    </Box>;
}

export interface PanelApplication {
    config: {name: string; clock_format: string};
    launcher: {toggle(monitor: Gdk.Monitor): void};
    runCommand(command: 'terminal' | 'files'): boolean;
    extensions?: SettingsHost;
    spacing?: number;
    options?: PanelOptions;
    showSettings?(): void;
    showWifi?(): void;
    showLanguage?(): void;
    showTime?(): void;
    switchUser?(username?: string): void;
    showAccounts?(): void;
    toggleTaskView?(monitor: Gdk.Monitor): void;
    devices?: DeviceControls;
    windows?: WindowControls;
}
const alertIcon = new Gio.FileIcon({file: Gio.File.new_for_path(`${ROOT}/extensions/org.devos.panel/icons/bell-symbolic.svg`)});
const unavailable: DeviceState = {connected: false, wireless: false, network: 'Network unavailable', wifi: null,
    bluetooth: null, volume: null, muted: false, battery: null, busy: false, error: ''};

function PanelUserButton({switchUser, showAccounts, position}: {switchUser(username?: string): void; showAccounts?(): void; position: 'top' | 'bottom'}) {
    const anchor = useRef<Gtk.Button | null>(null);
    const [system, setSystem] = useState<AccountResult['system']>();
    const [error, setError] = useState('');
    const backend = useRef<Accounts | null>(null);
    const refresh = () => {void backend.current?.request('get').then(value => {setSystem(value.system); setError('');}).catch(reason => setError(String(reason)));};
    useEffect(() => {let alive = true; const service = new Accounts(); backend.current = service; void service.request('get').then(value => {if (alive) setSystem(value.system);}).catch(() => {}); return () => {alive = false; backend.current = null; service.destroy();};}, []);
    const current = system?.currentUser ?? GLib.get_user_name();
    const toggle = usePopup(anchor, <Box id="panel-user-popup" className="quick-settings" orientation="vertical" spacing={14} borderWidth={20} widthRequest={300}>
        <Label className="popup-title" xalign={0}>Your account</Label>
        <Box spacing={12}><AccountAvatar githubId={system?.binding?.id} size={44} /><Box orientation="vertical" spacing={4} valign="center"><Label xalign={0}>{current}</Label><Label className="popup-muted" xalign={0}>{system?.binding ? '@' + system.binding.login : 'Local account'}</Label></Box></Box>
        <Label className="popup-muted" xalign={0}>SWITCH OS USER</Label>
        {(system?.users ?? []).filter(user => user.username !== current).map(user => <Button key={user.username} id={`panel-user-${user.username}`} onClicked={() => {toggle(); switchUser(user.username);}}><Box spacing={10}><AccountAvatar githubId={user.githubId} size={32} /><Box orientation="vertical" spacing={3} expand><Label xalign={0}>{user.name}</Label><Label className="popup-muted" xalign={0}>{user.github ? '@' + user.github : user.username}</Label></Box><Image iconName="go-next-symbolic" pixelSize={16} /></Box></Button>)}
        <Button id="panel-user-switch" onClicked={() => {toggle(); switchUser();}}>Switch user…</Button>
        {showAccounts && <Button id="panel-user-settings" onClicked={() => {toggle(); showAccounts();}}>Account settings</Button>}
        <PanelPowerControls />
        {!!error && <Label className="popup-muted" wrap maxWidthChars={38}>{error}</Label>}
    </Box>, position);
    return <Button id="panel-switch-user" ref={anchor} className="panel-app" tooltip={`${current} · Accounts`} onClicked={() => {refresh(); toggle();}}><AccountAvatar githubId={system?.binding?.id} size={20} /></Button>;
}

function usePopup(anchor: React.RefObject<Gtk.Button | null>, content: React.ReactNode, position: 'top' | 'bottom' = 'bottom') {
    const popup = useRef<Gtk.Popover | null>(null);
    const root = useRef<ReturnType<typeof createRoot> | null>(null);
    useLayoutEffect(() => {
        const widget = new Gtk.Popover({relative_to: anchor.current!, position: position === 'top' ? Gtk.PositionType.BOTTOM : Gtk.PositionType.TOP});
        widget.get_style_context().add_class('panel-popup');
        widget.set_constrain_to(Gtk.PopoverConstraint.NONE);
        popup.current = widget; root.current = createRoot(widget);
        return () => {
            // A nested React root may finish its unmount after the parent commit.
            // Detach first so destroying the anchor cannot destroy its widgets early.
            widget.set_relative_to(null);
            root.current?.unmount(); root.current = null; popup.current = null;
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { widget.destroy(); return GLib.SOURCE_REMOVE; });
        };
    }, [position]);
    useLayoutEffect(() => { root.current?.render(content); }, [content]);
    return () => {
        const widget = popup.current, button = anchor.current;
        if (!widget || !button) return;
        if (widget.get_visible()) { widget.popdown(); return; }
        // Keep the popup on the desktop side of either panel edge.
        const [translated, , y] = button.translate_coordinates(button.get_toplevel(), 0, 0);
        const offset = translated ? y : button.get_allocation().y;
        widget.set_pointing_to(new NativeGdk.Rectangle({x: 0, y: position === 'top' ? button.get_toplevel().get_allocated_height() - offset + 8 : -offset - 8,
            width: button.get_allocated_width(), height: 1}));
        widget.popup();
    };
}
function VolumeSlider({value, sensitive, change, id = 'panel-volume'}: {value: number; sensitive: boolean; change: (value: number) => void; id?: string}) {
    const [draft, setDraft] = useState(value), pending = useRef(0);
    useEffect(() => { setDraft(value); }, [value]);
    useEffect(() => () => { if (pending.current) GLib.source_remove(pending.current); }, []);
    return <Scale id={id} value={draft} drawValue={false} sensitive={sensitive} expand onValueChanged={widget => {
        const next = widget.get_value(); setDraft(next);
        if (pending.current) GLib.source_remove(pending.current);
        pending.current = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            pending.current = 0; change(next); return GLib.SOURCE_REMOVE;
        });
    }} />;
}
export function keyboardLabel(name: string): string {
    const labels: [RegExp, string][] = [[/thai/i, 'TH'], [/english/i, 'EN'], [/german/i, 'DE'], [/french/i, 'FR'], [/spanish/i, 'ES']];
    return labels.find(([pattern]) => pattern.test(name))?.[1] ?? name.slice(0, 2).toUpperCase();
}
export function PanelLanguageChoices({layouts, choose, settings}: {layouts: readonly KeyboardLayout[]; choose(index: number): void; settings?(): void}) {
    return <Box orientation="vertical" spacing={10} borderWidth={16} widthRequest={260}>
        <Label className="popup-title" xalign={0}>Keyboard language</Label>
        {layouts.map(layout => <Button key={layout.index} id={`panel-language-${layout.index}`} className={layout.active ? 'language-selected' : ''} onClicked={() => choose(layout.index)}><Box spacing={10}><Label widthChars={3}>{keyboardLabel(layout.name)}</Label><Label xalign={0} expand>{layout.name}</Label>{layout.active && <Image iconName="emblem-ok-symbolic" pixelSize={14} />}</Box></Button>)}
        {!layouts.length && <Label className="popup-muted" xalign={0} wrap>Restart the DevOs session to load the language indicator.</Label>}
        {settings && <Button id="panel-language-settings" onClicked={settings}><Box spacing={8}><Image iconName="preferences-system-symbolic" pixelSize={16} /><Label>Language settings</Label></Box></Button>}
    </Box>;
}
export function PanelLanguage({controls, showSettings, position}: {controls?: WindowControls; showSettings?(): void; position?: 'top' | 'bottom'}) {
    const [layouts, update] = useState(controls?.keyboardLayouts ?? []);
    const anchor = useRef<Gtk.Button>(null);
    useEffect(() => {const changed = () => update(controls?.keyboardLayouts ?? []); changed(); return controls?.subscribe(changed);}, [controls]);
    const current = layouts.find(layout => layout.active);
    const toggle = usePopup(anchor, <PanelLanguageChoices layouts={layouts} choose={index => {controls?.setKeyboardLayout?.(index); toggle();}} settings={showSettings ? () => {toggle(); showSettings();} : undefined} />, position);
    return <Button id="panel-language" ref={anchor} className="tray-button panel-language" tooltip={current ? `${current.name} · Change keyboard language` : 'Keyboard language'} onClicked={toggle}><Label id="panel-language-label" widthChars={3}>{current ? keyboardLabel(current.name) : '—'}</Label></Button>;
}
function QuickSettings({application, device}: {application: PanelApplication; device: DeviceState}) {
    const controls = application.devices;
    return <Box className="quick-settings" orientation="vertical" spacing={18} borderWidth={20} widthRequest={320}>
        <Box><Label className="popup-title" xalign={0} expand>Quick settings</Label>
            {application.showSettings && <Button className="popup-icon" tooltip="Settings" onClicked={() => application.showSettings?.()}><Image iconName="preferences-system-symbolic" pixelSize={18} /></Button>}
        </Box>
        <Box spacing={10} homogeneous>
            <Button id="panel-wifi" className={`device-tile ${device.wifi ? 'device-on' : ''}`} sensitive={(!!application.showWifi || device.wifi !== null) && !device.busy}
                tooltip={application.showWifi ? 'Wi-Fi networks and settings' : 'Toggle Wi-Fi'} onClicked={() => { if (application.showWifi) application.showWifi(); else void controls?.toggleWifi(); }}>
                <Box orientation="vertical" spacing={8}><Image iconName="network-wireless-symbolic" pixelSize={24} /><Label>Wi-Fi</Label><Label className="tile-detail">{device.wifi === null ? application.showWifi ? 'Networks' : 'Unavailable' : device.wifi ? 'On' : 'Off'}</Label></Box>
            </Button>
            <Button id="panel-bluetooth" className={`device-tile ${device.bluetooth ? 'device-on' : ''}`} sensitive={device.bluetooth !== null && !device.busy}
                tooltip={device.bluetooth === null ? 'No Bluetooth controller available' : 'Toggle Bluetooth'} onClicked={() => { void controls?.toggleBluetooth(); }}>
                <Box orientation="vertical" spacing={8}><Image iconName="bluetooth-active-symbolic" pixelSize={24} /><Label>Bluetooth</Label><Label className="tile-detail">{device.bluetooth === null ? 'Unavailable' : device.bluetooth ? 'On' : 'Off'}</Label></Box>
            </Button>
        </Box>
        <Box spacing={8}><Image iconName={device.connected ? device.wireless ? 'network-wireless-signal-excellent-symbolic' : 'network-wired-symbolic' : 'network-offline-symbolic'} pixelSize={16} /><Label className="popup-muted" xalign={0}>{device.network}</Label></Box>
        <Box spacing={12}>
            <Button id="panel-mute" className="popup-icon" tooltip={device.muted ? 'Unmute' : 'Mute'} sensitive={device.volume !== null && !device.busy} onClicked={() => { void controls?.toggleMute(); }}>
                <Image iconName={device.muted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic'} pixelSize={20} />
            </Button>
            <VolumeSlider value={device.volume ?? 0} sensitive={device.volume !== null && !device.busy} change={value => { void controls?.setVolume(value); }} />
            <Label widthChars={4}>{device.volume === null ? '—' : `${device.volume}%`}</Label>
        </Box>
        {device.volume === null && <Label className="popup-muted" wrap xalign={0}>Audio output unavailable. Requires PipeWire or PulseAudio.</Label>}
        <Box spacing={12}><Image iconName="display-brightness-symbolic" pixelSize={20} />
            <VolumeSlider id="panel-brightness" value={device.brightness ?? 0} sensitive={device.brightness != null && !device.busy} change={value => {void controls?.setBrightness?.(value);}} />
            <Label widthChars={4}>{device.brightness == null ? '�' : `${device.brightness}%`}</Label>
        </Box>
        {device.brightness == null && <Label className="popup-muted" wrap xalign={0}>Brightness unavailable: no kernel backlight device.</Label>}
        {device.battery !== null && <Label className="popup-muted" xalign={0}>{`Battery · ${device.battery}%`}</Label>}
        {device.error && <Label className="error" wrap xalign={0}>{device.error}</Label>}
    </Box>;
}
function TaskButton({application, id, title, iconName, gicon, windows, launch}: {
    application: PanelApplication; id: string; title: string; iconName: string; gicon?: Gio.Icon | null;
    windows: readonly DesktopWindow[]; launch?: () => void;
}) {
    const anchor = useRef<Gtk.Button>(null);
    const running = windows.length > 0, active = windows.some(window => window.active), minimized = running && windows.every(window => window.minimized);
    const togglePicker = usePopup(anchor, <Box orientation="vertical" spacing={8} borderWidth={14} widthRequest={280}>
        <Label className="popup-title" xalign={0}>{title}</Label>
        {windows.map(window => <Button key={window.id} id={`panel-window-${window.id}`} tooltip={window.title}
            onClicked={() => { application.windows?.activate(window.id); togglePicker(); }}>
            <Box spacing={8}><Image gicon={gicon} iconName={iconName} pixelSize={16} /><Label xalign={0} expand wrap maxWidthChars={34}>{window.title || title}</Label>{window.minimized && <Image iconName="window-minimize-symbolic" pixelSize={12} />}</Box>
        </Button>)}
        {launch && <Button onClicked={() => { togglePicker(); launch(); }}>New window</Button>}
    </Box>, application.options?.position);
    return <Button id={id} ref={anchor} className={`panel-app panel-task ${running ? 'task-running' : ''} ${active ? 'task-active' : ''} ${minimized ? 'task-minimized' : ''}`}
        tooltip={running ? `${title} · ${windows.length} window${windows.length > 1 ? 's' : ''}${minimized ? ' · Minimized' : active ? ' · Active' : ''}` : title}
        onClicked={() => { if (!running) launch?.(); else if (windows.length === 1) application.windows?.toggle(windows[0].id); else togglePicker(); }}>
        <Image gicon={gicon} iconName={iconName} pixelSize={application.options?.iconSize ?? 16} />
    </Button>;
}
function PanelView({application, monitor, message}: {application: PanelApplication; monitor: Gdk.Monitor; message: string}) {
    const options = application.options ?? panelOptions({spacing: application.spacing ?? 12});
    const [now, setNow] = useState(() => GLib.DateTime.new_now_local());
    const [device, setDevice] = useState(application.devices?.state ?? unavailable);
    const [windows, setWindows] = useState(application.windows?.state ?? []);
    const [desktopApps, setDesktopApps] = useState(installedDesktopApps);
    useEffect(() => {
        const appMonitor = Gio.AppInfoMonitor.get();
        const screen = NativeGdk.Display.get_default()!.get_default_screen();
        const update = () => {
            Gtk.IconTheme.get_for_screen(screen).rescan_if_needed();
            setDesktopApps(installedDesktopApps());
        };
        const signal = appMonitor.connect('changed', update);
        update();
        return () => { appMonitor.disconnect(signal); };
    }, []);
    useEffect(() => {
        const update = () => setWindows(application.windows?.state ?? []);
        update(); return application.windows?.subscribe(update);
    }, [application.windows]);
    const [alerts, setAlerts] = useState<{message: string; time: string}[]>([]);
    const deviceAnchor = useRef<Gtk.Button>(null), alertAnchor = useRef<Gtk.Button>(null), clockAnchor = useRef<Gtk.Button>(null);
    useEffect(() => {
        const source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => { setNow(GLib.DateTime.new_now_local()); return GLib.SOURCE_CONTINUE; });
        return () => { GLib.source_remove(source); };
    }, []);
    useEffect(() => application.devices?.subscribe(() => setDevice(application.devices!.state)), [application.devices]);
    useEffect(() => { if (message) setAlerts(previous => [{message, time: GLib.DateTime.new_now_local().format('%H:%M') ?? ''}, ...previous].slice(0, 30)); }, [message]);
    const toggleDevices = usePopup(deviceAnchor, <QuickSettings {...{application, device}} />, options.position);
    const toggleAlerts = usePopup(alertAnchor, <Box orientation="vertical" spacing={16} borderWidth={20} widthRequest={320}>
        <Box><Label className="popup-title" xalign={0} expand>Desktop alerts</Label><Button sensitive={alerts.length > 0} onClicked={() => setAlerts([])}>Clear</Button></Box>
        {!alerts.length ? <Box className="alerts-empty" orientation="vertical" spacing={12} borderWidth={24}><Image gicon={alertIcon} pixelSize={32} /><Label>No new notifications</Label><Label className="popup-muted">You're all caught up.</Label></Box> :
            <Box orientation="vertical" spacing={8}>{alerts.slice(0, 5).map((alert, index) => <Box key={index} className="alert-card" orientation="vertical" spacing={6} borderWidth={12}><Label className="popup-muted" xalign={0}>{alert.time}</Label><Label wrap xalign={0}>{alert.message}</Label></Box>)}</Box>}
    </Box>, options.position);
    const toggleClock = usePopup(clockAnchor, <Box orientation="vertical" spacing={12} borderWidth={24} widthRequest={280}><Label className="popup-title" xalign={0}>{now.format('%A')}</Label><Label className="calendar-date" xalign={0}>{now.format('%d %B %Y')}</Label><Label className="popup-muted" xalign={0}>{now.format('%H:%M:%S · %Z')}</Label>{application.showTime && <Button id="panel-time-settings" onClicked={() => {toggleClock(); application.showTime!();}}>Time settings</Button>}</Box>, options.position);
    const audioIcon = device.volume === null ? 'audio-volume-muted-symbolic' : device.muted || device.volume === 0 ? 'audio-volume-muted-symbolic' : device.volume < 40 ? 'audio-volume-low-symbolic' : 'audio-volume-high-symbolic';
    const groups = new Map<string, DesktopWindow[]>();
    for (const window of windows) { const group = windowGroup(window); groups.set(group, [...(groups.get(group) ?? []), window]); }
    return <Box className="panel-content" spacing={options.spacing} marginStart={6} marginEnd={6}>
        <Box spacing={options.itemSpacing} valign="center">

            <Button id="panel-menu" className="panel-app menu-button" tooltip="Applications · Super / Windows" onClicked={() => application.launcher.toggle(monitor)}><Image iconName="view-app-grid-symbolic" pixelSize={options.iconSize} /></Button>
            {application.toggleTaskView && <Button id="panel-task-view" className="panel-app" tooltip="Task View · Super + Tab" onClicked={() => application.toggleTaskView!(monitor)}><Image iconName="view-grid-symbolic" pixelSize={options.iconSize} /></Button>}
            {options.showPinned && <TaskButton application={application} id="panel-terminal" title="Terminal" iconName="utilities-terminal-symbolic" windows={groups.get('terminal') ?? []} launch={() => application.runCommand('terminal')} />}
            {options.showPinned && <TaskButton application={application} id="panel-files" title="Files" iconName="folder-symbolic" windows={groups.get('files') ?? []} launch={() => application.runCommand('files')} />}
            {[...groups].filter(([group]) => !options.showPinned || !['terminal', 'files'].includes(group)).map(([group, items]) => {
                const desktop = findDesktopApp(desktopApps, group);
                const icon = group === 'settings' ? null : desktop?.get_icon();
                return <TaskButton key={group} application={application} id={`panel-task-${items[0].id}`} title={desktop?.get_display_name() || items[0].title || group}
                    gicon={icon} iconName={group === 'settings' ? 'preferences-system-symbolic' : group === 'terminal' ? 'utilities-terminal-symbolic' : group === 'files' ? 'folder-symbolic' : 'application-x-executable-symbolic'} windows={items} />;
            })}
        </Box>
        <Box expand />
        <Box spacing={options.itemSpacing} valign="center">
            <PanelLanguage controls={application.windows} showSettings={application.showLanguage} position={options.position} />
            <Button id="panel-devices" ref={deviceAnchor} className="tray-button" tooltip={`${device.network} · ${device.volume === null ? 'Audio unavailable' : device.muted ? 'Muted' : `Volume ${device.volume}%`}`} onClicked={toggleDevices}>
                <Box spacing={5}><Image iconName={device.connected ? device.wireless ? 'network-wireless-signal-excellent-symbolic' : 'network-wired-symbolic' : 'network-offline-symbolic'} pixelSize={16} /><Image iconName={audioIcon} pixelSize={16} />{device.battery !== null && <Image iconName={device.battery < 20 ? 'battery-low-symbolic' : 'battery-good-symbolic'} pixelSize={16} />}</Box>
            </Button>
            <Button id="panel-clock" ref={clockAnchor} className={`clock-button ${options.showDate ? '' : 'clock-single-line'}`} tooltip={now.format('%A, %d %B %Y') ?? undefined} onClicked={toggleClock}>
                <Box orientation="vertical" spacing={0}><Label className="clock-time" xalign={1}>{now.format(clockFormat(application.extensions, application.config.clock_format === '%a %d %b  ·  %H:%M' ? '%H:%M' : application.config.clock_format)) ?? now.format('%H:%M')}</Label>{options.showDate && <Label className="clock-date" xalign={1}>{now.format('%d/%m/%Y')}</Label>}</Box>
            </Button>
            <Button id="panel-alert" ref={alertAnchor} className={`alert-button ${alerts.length ? 'has-alerts' : ''}`} tooltip={alerts[0]?.message ?? 'Desktop alerts'} onClicked={toggleAlerts}>
                <Box spacing={5}><Image gicon={alertIcon} pixelSize={16} />{alerts.length > 0 && <Label className="alert-count">{alerts.length}</Label>}</Box>
            </Button>
            {application.switchUser && <PanelUserButton switchUser={application.switchUser} showAccounts={application.showAccounts} position={options.position} />}
        </Box>
    </Box>;
}
export function mountPanel(window: Gtk.Window, application: PanelApplication, monitor: Gdk.Monitor) {
    const root = createRoot(window);
    const showMessage = (message: string) => root.render(<PanelView {...{application, monitor, message}} />);
    showMessage('');
    return {root, showMessage};
}
