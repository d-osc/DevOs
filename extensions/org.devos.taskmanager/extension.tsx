import {Gtk, GLib, Pango, React, Box, Label, Button, SearchEntry, ScrolledWindow, ComboBoxText, createRoot, mountWindowHeader, useState, useEffect, type UIExtension} from '@dev-os/core';
import {Processes, type ProcessControls, type ProcessInfo, type ProcessState} from './processes.js';
import {TaskManagerSettings} from './settings.js';

export const memory = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${(bytes / 1048576).toFixed(1)} MB`;
export function TaskManager({controls}: {controls: ProcessControls}) {
    const [state, setState] = useState<ProcessState | null>(null), [error, setError] = useState('');
    const [query, setQuery] = useState(''), [sort, setSort] = useState('cpu'), [paused, setPaused] = useState(false);
    const [selected, setSelected] = useState<ProcessInfo | null>(null), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
    useEffect(() => {
        let alive = true, loading = false;
        const refresh = async () => {
            if (loading) return; loading = true;
            try {const next = await controls.load(); if (alive) {setState(next); setError(''); setSelected(old => next.processes.find(item => item.pid === old?.pid && item.start === old.start) ?? null);}}
            catch (reason) {if (alive) setError(String(reason));} finally {loading = false;}
        };
        if (!paused) void refresh();
        const timer = paused ? 0 : GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {void refresh(); return GLib.SOURCE_CONTINUE;});
        return () => {alive = false; if (timer) GLib.source_remove(timer);};
    }, [controls, paused]);
    const needle = query.trim().toLowerCase();
    const rows = (state?.processes ?? []).filter(item => `${item.name} ${item.pid} ${item.user}`.toLowerCase().includes(needle)).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'pid' ? a.pid - b.pid : sort === 'memory' ? b.memory - a.memory : b.cpu - a.cpu || b.memory - a.memory);
    const stop = async (force: boolean) => {
        if (!selected || busy) return; setBusy(true);
        try {await controls.stop(selected, force); setConfirm(false); setSelected(null); setState(await controls.load()); setError('');}
        catch (reason) {setError(String(reason));} finally {setBusy(false);}
    };
    return <Box className="task-manager-body" orientation="vertical" spacing={16}>
        <Box spacing={12}><Box orientation="vertical" expand><Label className="task-title" xalign={0}>Task Manager</Label><Label className="subtle" xalign={0}>See what is running on your desktop</Label></Box><Button onClicked={() => setPaused(value => !value)}>{paused ? 'Resume updates' : 'Pause updates'}</Button></Box>
        <Box spacing={12}>{[
            ['CPU', state ? `${state.cpu.toFixed(1)}%` : '—', state ? `${state.cores} logical CPUs` : 'Sampling…'],
            ['Memory', state ? `${Math.round(state.memoryUsed / state.memoryTotal * 100)}%` : '—', state ? `${memory(state.memoryUsed)} / ${memory(state.memoryTotal)}` : 'Sampling…'],
            ['Swap', state ? memory(state.swapUsed) : '—', state ? `${memory(state.swapTotal)} available capacity` : 'Sampling…'],
        ].map(([title, value, detail]) => <Box key={title} className="task-stat" orientation="vertical" spacing={5} expand hexpand><Label className="subtle" xalign={0}>{title}</Label><Label className="task-value" xalign={0}>{value}</Label><Label className="subtle" xalign={0}>{detail}</Label></Box>)}</Box>
        <Box spacing={12}><SearchEntry id="task-search" expand hexpand placeholder="Search name, PID or user" text={query} onChanged={widget => setQuery(widget.get_text())}/><ComboBoxText activeId={sort} items={[{id:'cpu',text:'CPU usage'},{id:'memory',text:'Memory usage'},{id:'name',text:'Name'},{id:'pid',text:'PID'}]} onChanged={widget => setSort(widget.get_active_id() || 'cpu')}/></Box>
        <Box className="task-columns" spacing={12}><Label expand hexpand xalign={0}>PROCESS / USER</Label><Label widthChars={8}>PID</Label><Label widthChars={9}>CPU</Label><Label widthChars={12}>MEMORY</Label></Box>
        <ScrolledWindow expand vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box orientation="vertical" spacing={3}>
            {rows.slice(0, 500).map(item => <Button key={`${item.pid}:${item.start}`} className={`task-process${selected?.pid === item.pid && selected.start === item.start ? ' selected' : ''}`} onClicked={() => {setSelected(item); setConfirm(false);}}><Box spacing={12}>
                <Box orientation="vertical" expand hexpand><Label xalign={0} ellipsize={Pango.EllipsizeMode.END}>{item.name}</Label><Label className="subtle" xalign={0}>{`${item.user} · ${item.state === 'R' ? 'Running' : item.state === 'Z' ? 'Zombie' : item.state === 'T' ? 'Stopped' : 'Sleeping'}`}</Label></Box>
                <Label widthChars={8}>{String(item.pid)}</Label><Label widthChars={9}>{`${item.cpu.toFixed(1)}%`}</Label><Label widthChars={12}>{memory(item.memory)}</Label>
            </Box></Button>)}
            {!rows.length && <Label className="subtle">{state ? 'No matching processes' : 'Loading processes…'}</Label>}
        </Box></ScrolledWindow>
        {error && <Label className="error" wrap xalign={0}>{error}</Label>}
        {confirm && selected && <Box className="task-confirm" orientation="vertical" spacing={10}><Label wrap xalign={0}>{`Stop ${selected.name} (PID ${selected.pid})? Unsaved work may be lost. Force stop closes it immediately.`}</Label><Box spacing={8}><Button sensitive={!busy} onClicked={() => setConfirm(false)}>Cancel</Button><Button sensitive={!busy} onClicked={() => {void stop(false);}}>End task</Button><Button sensitive={!busy} onClicked={() => {void stop(true);}}>Force stop</Button></Box></Box>}
        <Box spacing={12}><Label className="subtle" expand xalign={0} wrap>{`${rows.length} processes${rows.length > 500 ? ' · showing first 500' : ''}${paused ? ' · paused' : ' · updates every 2s'} · CPU per process: 100% = one core`}</Label><Button id="task-end" sensitive={!!selected?.canStop && !busy} tooltip={selected?.canStop ? 'Stop selected process' : 'Select one of your own processes. Desktop and system processes are protected.'} onClicked={() => setConfirm(true)}>End task…</Button></Box>
    </Box>;
}
export default {id: 'org.devos.taskmanager', activate(context) {
    let window: Gtk.ApplicationWindow | undefined;
    context.registerSettingsPage?.('org.devos.taskmanager', () => <TaskManagerSettings openManager={() => context.invoke('task-manager')}/>);
    context.registerCommand('task-manager', () => {
        context.invoke('launcher.hide');
        if (window) {window.present(); return;}
        window = new Gtk.ApplicationWindow({application: context.application, title: 'Task Manager', default_width: 900, default_height: 680}); window.name = 'task-manager';
        const root = createRoot(window), header = mountWindowHeader(window, {title: 'Task Manager', iconName: 'utilities-system-monitor-symbolic'});
        let controls: Processes | undefined;
        try {controls = new Processes(); root.render(<TaskManager controls={controls}/>);} catch (reason) {root.render(<Label wrap>{String(reason)}</Label>);}
        window.connect('destroy', () => {root.unmount(); header.destroy(); controls?.destroy(); window = undefined;});
        window.show_all(); window.present();
    });
    return () => window?.destroy();
}} satisfies UIExtension;
