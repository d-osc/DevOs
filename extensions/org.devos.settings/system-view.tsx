import {React, Gtk, Gdk, GLib, Box, Label, Button, Image, Scale, ProgressBar, ScrolledWindow, useState, useEffect, useRef} from '@dev-os/core';
import {DisplaySettings} from './displays-view.js';
import {AudioSettings} from './audio-view.js';
import {SpeakerSettings} from './speaker-view.js';
import {DisplayCareSettings} from './display-care-view.js';
import type {DisplayCareControls} from './display-care.js';
import type {SpeakerControls} from './speaker.js';
import {PowerSettings} from './power-view.js';
import type {BatteryCareControls} from './battery-care.js';
import type {FanProfileControls} from './fan-profile.js';
import {AboutSettings} from './about-view.js';
import {VERSION} from '@dev-os/config';
import {Devices, type DeviceControls} from '../org.devos.panel/devices.js';
import {LinuxSystem, systemPages, formatBytes, type SystemControls, type SystemState, type SystemPage} from './system.js';

export interface DisplayInfo {name: string; width: number; height: number; scale: number; refresh: number; primary: boolean;}
function displays(): DisplayInfo[] {
    const display = Gdk.Display.get_default(); if (!display) return [];
    return Array.from({length: display.get_n_monitors()}, (_, index) => {const monitor = display.get_monitor(index)!; const size = monitor.get_geometry(); const model = monitor.get_model(); return {name: model && !/^unknown$/i.test(model) ? model : `Display ${index + 1}`, width: size.width, height: size.height, scale: monitor.get_scale_factor(), refresh: monitor.get_refresh_rate() / 1000, primary: monitor === display.get_primary_monitor()};});
}
function Detail({title, value}: {title: string; value: string}) {return <Box spacing={16}><Label className="settings-description" xalign={0} widthChars={20}>{title}</Label><Label className="settings-field-title" xalign={0} expand wrap selectable>{value || 'Unavailable'}</Label></Box>;}
function Card({children}: {children?: React.ReactNode}) {return <Box className="settings-card system-card" orientation="vertical" spacing={12}>{children}</Box>;}
export function SystemSound({controls, advanced}: {controls?: DeviceControls; advanced?(): void}) {
    const [backend] = useState(() => controls ?? new Devices());
    const [state, update] = useState(backend.state), [volume, setVolume] = useState(backend.state.volume ?? 0);
    const pending = useRef(0);
    useEffect(() => {const change = () => {update(backend.state); if (!pending.current) setVolume(backend.state.volume ?? 0);}; const unsubscribe = backend.subscribe(change); change(); return () => {unsubscribe(); if (pending.current) GLib.source_remove(pending.current); if (!controls && backend instanceof Devices) backend.destroy();};}, [backend, controls]);
    return <Card><Label className="section-heading" xalign={0}>Output volume</Label><Label className="settings-description" xalign={0} wrap>Adjust the default audio output used by your applications.</Label><Box spacing={12}><Button id="system-sound-mute" sensitive={state.volume !== null && !state.busy} tooltip={state.muted ? 'Unmute' : 'Mute'} onClicked={() => {void backend.toggleMute();}}><Image iconName={state.muted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic'} pixelSize={22} /></Button><Scale id="system-sound-volume" expand value={volume} sensitive={state.volume !== null && !state.busy} drawValue={false} onValueChanged={widget => {const next = widget.get_value(); if (Math.abs(next - volume) < 0.01) return; setVolume(next); if (pending.current) GLib.source_remove(pending.current); pending.current = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {pending.current = 0; void backend.setVolume(next); return GLib.SOURCE_REMOVE;});}} /><Label widthChars={5}>{state.volume === null ? '—' : `${Math.round(volume)}%`}</Label></Box>{state.volume === null && <Label className="settings-description" xalign={0} wrap>No default audio output is available.</Label>}{state.error && <Label className="settings-error-banner" xalign={0} wrap>{state.error}</Label>}{advanced && <Button id="system-sound-advanced" onClicked={advanced}><Label>Input, output &amp; application audio</Label></Button>}</Card>;
}
export function SystemSettings({page, navigate, controls, openFiles, monitors, battery, fan, speaker, care}: {page: SystemPage; navigate(page: string): void; controls?: SystemControls; openFiles?(): void; monitors?: readonly DisplayInfo[]; battery?: BatteryCareControls; fan?: FanProfileControls; speaker?: SpeakerControls; care?: DisplayCareControls}) {
    const [backend] = useState(() => controls ?? new LinuxSystem());
    const [state, setState] = useState<SystemState | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('');
    const [screens, setScreens] = useState(() => monitors ?? displays());
    const [profile, setProfile] = useState('');
    useEffect(() => {let alive = true; void backend.load().then(next => {if (alive) {setState(next); setProfile(next.power.active); setBusy(false);}}).catch(reason => {if (alive) {setError(String(reason)); setBusy(false);}}); return () => {alive = false; backend.destroy();};}, [backend]);
    useEffect(() => {if (monitors) {setScreens(monitors); return;} const display = Gdk.Display.get_default(); if (!display) return; const update = () => setScreens(displays()); const added = display.connect('monitor-added', update), removed = display.connect('monitor-removed', update); const screen = display.get_default_screen(), changed = screen.connect('monitors-changed', update); return () => {display.disconnect(added); display.disconnect(removed); screen.disconnect(changed);};}, [monitors]);
    const refresh = async () => {setBusy(true); setError(''); try {const next = await backend.load(); setState(next); setProfile(next.power.active); setScreens(monitors ?? displays());} catch (reason) {setError(String(reason));} finally {setBusy(false);}};
    const open = async (target: string) => {setBusy(true); setError(''); try {await backend.open(target, state?.hostManaged === true);} catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));} finally {setBusy(false);}};
    const title = page === 'system' ? 'System' : systemPages.find(item => item.id === page)!.title;
    const description = page === 'system' ? 'Your device, displays, sound and system information.' : systemPages.find(item => item.id === page)!.description;
    const canOpen = (target: string) => !busy && !!state && (state.hostManaged ? state.hostSettings : state.tools[target] === true);
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={10}>
            <Box spacing={8}><Button id="system-back" sensitive={page !== 'system'} onClicked={() => navigate('system')}><Box spacing={6}><Image iconName="go-previous-symbolic" pixelSize={14} /><Label>System</Label></Box></Button><Label className="settings-eyebrow" xalign={0} expand>{page === 'system' ? 'DEVICE & WORKSPACE' : `SYSTEM / ${title.toUpperCase()}`}</Label><Button id="system-refresh" sensitive={!busy} onClicked={() => {void refresh();}} tooltip="Refresh system information"><Image iconName="view-refresh-symbolic" pixelSize={16} /></Button></Box>
            <Label className="heading" xalign={0}>{title}</Label><Label className="settings-description" xalign={0} wrap>{description}</Label>
        </Box>
        <ScrolledWindow expand fill minContentHeight={200} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                {page === 'system' && <><Card><Box spacing={16}><Image iconName="computer-symbolic" pixelSize={40} /><Box orientation="vertical" spacing={6} expand><Label id="system-device-name" className="section-heading" xalign={0}>{state?.hostname || 'Your device'}</Label><Label className="settings-description" xalign={0} wrap>{state ? `${state.architecture} · ${formatBytes(state.memory)} RAM${state.hostManaged ? ' · WSL runtime' : ''}` : 'Reading system information…'}</Label></Box><Label className="settings-badge">DevOs {VERSION}</Label></Box></Card><Box className="settings-card" orientation="vertical">{systemPages.map((item, index) => <Button key={item.id} id={`system-category-${item.id}`} className={`network-category ${index ? 'network-category-divider' : ''}`} onClicked={() => navigate(item.id)}><Box spacing={14}><Image iconName={item.icon} pixelSize={25} /><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>{item.title}</Label><Label className="settings-description" xalign={0} wrap>{item.description}</Label></Box><Image iconName="go-next-symbolic" pixelSize={16} /></Box></Button>)}</Box></>}
                {page === 'display' && (state?.hostManaged ? <Card><Label className="section-heading" xalign={0}>Connected displays</Label>{screens.map((screen, index) => <Label key={index} id={`system-display-${index}`} xalign={0}>{`${screen.name} · ${screen.width} × ${screen.height}`}</Label>)}<Label className="settings-description" wrap>Windows controls the physical screens in this session.</Label><Button id="system-display-configure" sensitive={canOpen('display')} onClicked={() => {void open('display');}}>Open Windows display settings</Button></Card> : !busy && <><DisplaySettings /><DisplayCareSettings controls={care} /></>)}
                {page === 'sound' && <AudioSettings afterOutput={<SpeakerSettings controls={speaker} />} />}
                {page === 'power' && state && <PowerSettings battery={battery} fan={fan} state={state} busy={busy} selected={profile} select={setProfile} openHost={() => {void open('power');}} apply={() => {setBusy(true); setError(''); void backend.profile(profile).then(next => {setState(next); setProfile(next.power.active);}).catch(reason => setError(String(reason))).finally(() => setBusy(false));}} />}
                {page === 'storage' && <>{state?.storage.map(disk => <Card key={disk.path}><Label className="section-heading" xalign={0}>{disk.path === '/' ? 'System disk' : disk.path}</Label><Detail title="Used" value={`${formatBytes(disk.used)} of ${formatBytes(disk.total)}`} /><ProgressBar fraction={disk.total ? Math.min(1, disk.used / disk.total) : 0} /><Detail title="Available" value={formatBytes(disk.free)} /><Label className="settings-description" xalign={0}>{disk.path}</Label></Card>)}{state?.hostManaged && <Label className="settings-description" xalign={0} wrap>This is the Linux filesystem capacity, which may differ from free space on the Windows host.</Label>}{openFiles && <Button id="system-storage-files" onClicked={openFiles}><Label>Open Files</Label></Button>}{state?.hostManaged && <Button id="system-storage-host" sensitive={!busy && state.hostSettings} onClicked={() => {void open('storage');}}><Label>Open Windows storage settings</Label></Button>}</>}
                {page === 'about' && <AboutSettings state={state} />}
                {busy && <Label className="settings-description" xalign={0}>Reading / updating system settings…</Label>}
                {error && <Label id="system-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
            </Box>
        </ScrolledWindow>
    </Box>;
}
