import {Gtk, Gdk, GLib, React, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {TaskManager} from '../extensions/org.devos.taskmanager/extension.js';
import {TaskManagerSettings} from '../extensions/org.devos.taskmanager/settings.js';
import {Processes, type ProcessControls} from '../extensions/org.devos.taskmanager/processes.js';
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
    const controls: ProcessControls = {async load() {return {...live, processes: [{pid: 123, name: 'Demo', user: 'alice', uid: 1000, state: 'S', cpu: 25, memory: 12345678, start: 'abc', canStop: true}]};}, async stop(item, force) {if (item.pid !== 123 || force) throw new Error('Wrong stop target'); stopped = true;}, destroy() {}};
    const window = new Gtk.OffscreenWindow(); window.name = 'task-manager'; window.set_default_size(900, 680); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replaceAll('@ACCENT@', '#88e0c0')));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = (name: string) => widgets(window).find(widget => widget.name === name)!;
    try {
        root.render(<TaskManager controls={controls}/>); window.show_all(); await wait(); await wait();
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
    } finally {root.unmount(); window.destroy(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css);}
    print('PASS: real process bridge, selection, confirmation, end task and search');
}
let failure: unknown; void test().catch(error => {failure = error;}).finally(() => loop.quit()); loop.run(); if (failure) throw failure;
