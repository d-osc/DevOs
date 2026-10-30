import {testTheme} from './theme-helper.js';
import {Gtk, Gdk, GLib, React, Label, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {TaskManager, sameState, ROW_LIMIT} from '../src/apps/org.devos.taskmanager/extension.js';
import {TaskManagerSettings} from '../src/apps/org.devos.taskmanager/settings.js';
import {Processes, type ProcessControls, type ProcessInfo} from '../src/apps/org.devos.taskmanager/processes.js';
Gtk.init(null);
const loop = new GLib.MainLoop(null, false);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const widgets = (widget: Gtk.Widget): Gtk.Widget[] => [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];
async function test() {
    const backend = new Processes();
    let stopped = false;
    const live = await backend.load();
    if (!live.processes.length || !live.memoryTotal) throw new Error('Real backend bridge failed');
    backend.destroy();
    const controls: ProcessControls = {async load() {return {...live, processes: [{pid: 123, name: 'App Store · UI', command: 'gjs -m /fixture/dist/app-host.js appstore', user: 'alice', uid: 1000, state: 'S', cpu: 25, memory: 12345678, gpu: 37.5, gpuMemory: 67108864, swap: 4194304, diskRead: 1024, diskWrite: 4096, networkReceive: 2048, networkSend: null, start: 'abc', canStop: true}]};}, async stop(item, force) {if (item.pid !== 123 || force) throw new Error('Wrong stop target'); stopped = true;}, destroy() {}};
    const window = new Gtk.OffscreenWindow(); window.name = 'task-manager'; window.set_default_size(900, 680); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = (name: string) => widgets(window).find(widget => widget.name === name)!;
    try {
        root.render(<TaskManager controls={controls}/>); window.show_all(); await wait(); await wait();
        for (const text of ['App Store · UI', '37.5%', '64.0 MB', '4.0 MB', 'R 1.0 KB/s', 'W 4.0 KB/s', '↓ 2.0 KB/s', '↑ —']) {
            if (!widgets(window).some(widget => widget instanceof Gtk.Label && widget.label === text)) throw new Error(`Missing process metric: ${text}`);
        }
        (find('task-search') as Gtk.SearchEntry).set_text('gjs'); await wait(); await wait();
        if (!widgets(window).some(widget => widget instanceof Gtk.Label && widget.label === 'App Store · UI')) throw new Error('Original command must remain searchable');
        (find('task-search') as Gtk.SearchEntry).set_text(''); await wait(); await wait();
        const screenshot = GLib.getenv('DEV_OS_TASK_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        const end = find('task-end') as Gtk.Button;
        if (end.sensitive) throw new Error('No selection must disable termination');
        (widgets(window).find(widget => widget instanceof Gtk.Button && widget.get_style_context().has_class('task-process')) as Gtk.Button).clicked(); await wait();
        end.clicked(); await wait();
        if (stopped) throw new Error('Must confirm before termination');
        (widgets(window).find(widget => widget instanceof Gtk.Button && widget.get_label() === 'End task') as Gtk.Button).clicked(); await wait();
        if (!stopped) throw new Error('Confirmed termination not forwarded');
        (find('task-search') as Gtk.SearchEntry).set_text('missing'); await wait();
        if (!widgets(window).some(widget => widget instanceof Gtk.Label && widget.label === 'No matching processes')) throw new Error('Search failed');
        window.name='settings';window.set_size_request(1000,760);let opened=0,failed=false,loads=0;
        const settingsControls:ProcessControls={async load(){loads++;if(failed)throw new Error('Sampler unavailable');return {...live,processes:[],swapTotal:0,swapUsed:0,cpu:12.5,uptime:90061};},async stop(){throw new Error('Settings must never stop processes');},destroy(){}};
        root.render(<TaskManagerSettings controls={settingsControls} openManager={()=>opened++}/>);await wait();await wait();
        if((find('task-settings-cpu') as Gtk.Label).label!=='12.5%')throw new Error('CPU snapshot not shown');
        if((find('task-settings-swap') as Gtk.Label).label!=='None')throw new Error('No-swap state not shown');
        if((find('task-settings-uptime') as Gtk.Label).label!=='1d 1h 1m')throw new Error('Uptime not formatted');
        (find('task-settings-open') as Gtk.Button).clicked();if(opened!==1)throw new Error('Settings must open Task Manager');
        const settingsScreenshot=GLib.getenv('DEV_OS_TASK_SETTINGS_SCREENSHOT');if(settingsScreenshot)window.get_pixbuf()!.savev(settingsScreenshot,'png',[],[]);
        failed=true;(find('task-settings-refresh') as Gtk.Button).clicked();await wait();if(!find('task-settings-error'))throw new Error('Sampler error must be visible');
        failed=false;(find('task-settings-refresh') as Gtk.Button).clicked();await wait();if(find('task-settings-error')||loads!==3)throw new Error('Snapshot refresh must recover');
        // Throttling: no sampling while suspended (interval 0), sampling resumes when it is re-enabled.
        window.name = 'task-manager'; let sampled = 0;
        const row = (pid: number, cpu: number) => ({pid, name: `P${pid}`, user: 'alice', uid: 1000, state: 'S', cpu, memory: 1048576 * pid, start: `s${pid}`, canStop: true});
        let table: ProcessInfo[] = Array.from({length: 40}, (_, index) => row(index + 1, 1));
        const counting: ProcessControls = {async load() {sampled++; return {...live, processes: table.map(item => ({...item}))};}, async stop() {}, destroy() {}};
        root.render(<TaskManager controls={counting} interval={0}/>); await wait(); await wait();
        if (sampled !== 0) throw new Error('A suspended Task Manager must not sample');
        root.render(<TaskManager controls={counting} interval={50}/>); await wait(); await wait(); await wait();
        if (sampled < 3) throw new Error(`Sampling must resume and repeat, got ${sampled}`);
        root.render(<TaskManager controls={counting} interval={0}/>); await wait(); const frozen = sampled; await wait(); await wait();
        if (sampled !== frozen) throw new Error('Sampling must stop again when suspended');
        // Diffing: unchanged samples keep the same row widgets; a changed value updates a row in place.
        const rows = () => widgets(window).filter(widget => widget instanceof Gtk.Button && widget.get_style_context().has_class('task-process'));
        root.render(<TaskManager controls={counting} interval={50}/>); await wait(); await wait();
        const before = rows(); if (before.length !== 40) throw new Error(`Expected 40 rows, got ${before.length}`);
        await wait(); await wait(); if (rows().some((widget, index) => widget !== before[index])) throw new Error('Unchanged samples must not rebuild rows');
        table = table.map(item => item.pid === 7 ? {...item, cpu: 55} : item); await wait(); await wait(); await wait();
        const after = rows(); if (after.length !== 40 || after.filter((widget, index) => widget !== before[index]).length > 0 && after.length !== before.length) throw new Error('Changed sample must update rows');
        if (!widgets(window).some(widget => widget instanceof Gtk.Label && widget.label === '55.0%')) throw new Error('Changed CPU value not rendered');
        table = table.map(item => item.pid === 7 ? {...item, gpu: 42, gpuMemory: 33554432, swap: 4194304, diskRead: 1024, diskWrite: 4096, networkReceive: 8192, networkSend: 0} : item);
        await wait(); await wait(); await wait();
        if (!widgets(window).some(widget => widget instanceof Gtk.Label && widget.label === '↓ 8.0 KB/s')) throw new Error('Metric changes must repaint memoized rows');
        if (!widgets(window).some(widget => widget instanceof Gtk.Label && widget.label === '42.0%')) throw new Error('GPU changes must repaint memoized rows');
        for (const sort of ['gpu', 'gpuMemory', 'swap', 'disk', 'network']) {
            (find('task-sort') as Gtk.ComboBoxText).set_active_id(sort); await wait(); await wait();
            if (!widgets(rows()[0]).some(widget => widget instanceof Gtk.Label && widget.label === 'P7')) throw new Error(`Wrong metric sort: ${sort}`);
        }
        // Large lists are capped.
        table = Array.from({length: ROW_LIMIT + 50}, (_, index) => row(index + 1, 0)); await wait(); await wait(); await wait();
        if (rows().length !== ROW_LIMIT) throw new Error(`Row cap not applied, got ${rows().length}`);
        const base = {...live, processes: [row(1, 1), row(2, 2)]};
        if (!sameState(base, {...base, processes: base.processes.map(item => ({...item}))}) || sameState(base, {...base, processes: [row(1, 1), row(2, 3)]}) || sameState(null, base)) throw new Error('sameState comparison wrong');
        for (const field of ['gpu', 'gpuMemory', 'swap', 'diskRead', 'diskWrite', 'networkReceive', 'networkSend']) {
            if (sameState(base, {...base, processes: [{...base.processes[0], [field]: 1024}, base.processes[1]]})) throw new Error(`sameState ignores ${field}`);
        }
        root.render(<Label>done</Label>); await wait();
    } finally {root.unmount(); window.destroy(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css);}
    print('PASS: real process bridge, selection, confirmation, end task and search');
}
let failure: unknown; void test().catch(error => {failure = error;}).finally(() => loop.quit()); loop.run(); if (failure) throw failure;
