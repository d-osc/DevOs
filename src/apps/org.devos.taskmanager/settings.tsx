import {Gtk, React, Box, Label, Button, Image, ScrolledWindow, useEffect, useRef, useState} from '@dev-os/core';
import {Processes, type ProcessControls, type ProcessState} from './processes.js';

const memory = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
const uptime = (seconds: number) => `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
export function TaskManagerSettings({openManager, controls}: {openManager: () => void; controls?: ProcessControls}) {
    const backend = useRef<ProcessControls | null>(controls ?? null), alive = useRef(true), loading = useRef(false);
    const [state, setState] = useState<ProcessState | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('');
    const refresh = async () => {
        if (loading.current) return; loading.current = true; setBusy(true); setError('');
        try {const service = backend.current ?? (backend.current = new Processes()); const next = await service.load(); if (alive.current) setState(next);}
        catch (reason) {if (alive.current) setError(String(reason));}
        finally {loading.current = false; if (alive.current) setBusy(false);}
    };
    useEffect(() => {alive.current = true; void refresh(); return () => {alive.current = false; if (!controls) {backend.current?.destroy(); backend.current = null;}};}, [controls]);
    const memoryPercent = state && state.memoryTotal > 0 ? Math.round(state.memoryUsed / state.memoryTotal * 100) : 0;
    const cards = [
        ['CPU', state ? `${state.cpu.toFixed(1)}%` : '—', state ? `${state.cores} logical CPUs` : 'Waiting for sample'],
        ['Memory', state ? `${memoryPercent}%` : '—', state ? `${memory(state.memoryUsed)} / ${memory(state.memoryTotal)}` : 'Waiting for sample'],
        ['Swap', state ? state.swapTotal ? memory(state.swapUsed) : 'None' : '—', state ? state.swapTotal ? `${memory(state.swapTotal)} total` : 'Swap is not configured' : 'Waiting for sample'],
    ];
    return <Box className="settings-content task-manager-settings" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={14}>
            <Label className="settings-eyebrow" xalign={0}>EXTENSIONS / TASK MANAGER</Label>
            <Box spacing={14}><Box className="settings-page-icon" widthRequest={48} heightRequest={48} valign="center"><Image iconName="dev-os-task-manager" pixelSize={26} expand/></Box>
                <Box orientation="vertical" spacing={5} expand><Label className="heading" xalign={0}>Task Manager</Label><Label className="settings-description" wrap xalign={0}>Understand what is using your system.</Label></Box>
                <Button id="task-settings-refresh" sensitive={!busy} valign="center" onClicked={() => {void refresh();}}>Refresh snapshot</Button>
            </Box>
        </Box>
        <ScrolledWindow expand fill hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box className="settings-form" orientation="vertical" spacing={16}>
            <Box className="settings-card task-settings-hero" orientation="vertical" spacing={14}>
                <Box spacing={10}><Label className="section-heading" expand xalign={0}>Your system at a glance</Label><Label className="settings-badge">SNAPSHOT</Label></Box>
                <Label className="settings-description" wrap xalign={0}>Review CPU and memory usage here, or open Task Manager to monitor processes and manage running applications.</Label>
                <Button id="task-settings-open" className="settings-primary" halign="start" onClicked={openManager}>Open Task Manager</Button>
            </Box>
            <Box spacing={12}>{cards.map(([title, value, detail]) => <Box key={title} className="settings-card" orientation="vertical" spacing={8} expand hexpand><Label className="settings-description" xalign={0}>{title}</Label><Label id={`task-settings-${title.toLowerCase()}`} className="heading" xalign={0}>{value}</Label><Label className="settings-description" wrap xalign={0}>{detail}</Label></Box>)}</Box>
            <Box className="settings-card" orientation="vertical" spacing={12}>
                <Label className="section-heading" xalign={0}>Monitoring</Label>
                <Box spacing={12}><Label className="settings-description" expand xalign={0}>Processes</Label><Label id="task-settings-processes">{state ? String(state.processes.length) : '—'}</Label></Box>
                <Box spacing={12}><Label className="settings-description" expand xalign={0}>System uptime</Label><Label id="task-settings-uptime">{state ? uptime(state.uptime) : '—'}</Label></Box>
                <Label className="settings-description" wrap xalign={0}>This page takes a snapshot when opened or refreshed. The Task Manager window updates every two seconds and includes a pause control. Process CPU usage uses 100% for one logical CPU.</Label>
            </Box>
            <Box className="settings-card" orientation="vertical" spacing={10}>
                <Label className="section-heading" xalign={0}>Process controls</Label>
                <Label className="settings-description" wrap xalign={0}>Select a process in Task Manager to end it. End task requests a normal exit; Force stop ends it immediately. Both require confirmation and may lose unsaved work. Only eligible processes belonging to your user can be stopped; the desktop and protected processes are excluded.</Label>
            </Box>
            <Box className="settings-card" orientation="vertical" spacing={10}><Label className="section-heading" xalign={0}>Linux session</Label><Label className="settings-description" wrap xalign={0}>Resource usage and processes come from Linux. When DevOs runs through WSL, Windows applications are outside this view.</Label></Box>
            {error && <Label id="task-settings-error" className="error" wrap selectable xalign={0}>{error}</Label>}
        </Box></ScrolledWindow>
        <Box className="settings-action-bar" spacing={10}><Image iconName={busy ? 'view-refresh-symbolic' : 'dev-os-task-manager'} pixelSize={16}/><Label className="settings-description" expand wrap xalign={0}>{busy ? 'Reading system resources…' : error ? 'Unable to load the snapshot. Try Refresh again.' : 'Snapshot loaded. Refresh to see the latest usage.'}</Label></Box>
    </Box>;
}
