import {React, Gtk, Gdk, GLib, createRoot} from '@dev-os/core';
import {TaskButton, panelTaskAt} from '../packages/compat/panel-legacy/view.js';
import {Windows, type DesktopWindow} from '@dev-os/services/windows';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
const wait = (ms = 30) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function emitEvent(widget: Gtk.Widget, signal: string, event: Gdk.Event): boolean {
    return (widget.emit as unknown as (signal: string, event: Gdk.Event) => boolean).call(widget, signal, event);
}
function widgets(widget: Gtk.Widget, seen = new Set<Gtk.Widget>()): Gtk.Widget[] {
    if (seen.has(widget)) return []; seen.add(widget);
    const children: Gtk.Widget[] = [];
    if (widget instanceof Gtk.Container) widget.forall(child => children.push(child));
    return [widget, ...children.flatMap(child => widgets(child, seen))];
}
async function verify() {
    const window = new Gtk.Window({default_width: 500, default_height: 48}), host = new Gtk.Box(); window.add(host);
    const root = createRoot(host), calls: string[] = [];
    const first: DesktopWindow = {id: 31, title: 'Project one', appId: 'test', active: true, minimized: false};
    const second: DesktopWindow = {id: 32, title: 'Project two', appId: 'test', active: false, minimized: true};
    const controls = {state: [first], subscribe: () => () => {}, activate: (id: number) => calls.push(`activate:${id}`), toggle: (id: number) => calls.push(`toggle:${id}`),
        minimize: (id: number) => calls.push(`minimize:${id}`), maximize: (id: number) => calls.push(`maximize:${id}`), close: (id: number) => calls.push(`close:${id}`)};
    const application = {config: {name: 'Test', clock_format: '%H:%M'}, launcher: {toggle() {}}, runCommand: () => true, windows: controls};
    const render = (state: DesktopWindow[]) => root.render(<TaskButton application={application} id="task-test" title="Editor" iconName="dev-os-editor-symbolic" windows={state}/>);
    const all = () => widgets(window);
    const button = () => all().find(widget => widget.name === 'task-test') as Gtk.Button;
    const popup = () => all().find(widget => widget instanceof Gtk.Popover) as Gtk.Popover;
    const click = (id: string) => {const widget = all().find(widget => widget.name === id) as Gtk.Button; assert(widget?.sensitive, `${id} is usable`); widget.clicked();};
    const rightClick = () => {
        const event = Gdk.Event.new(Gdk.EventType.BUTTON_PRESS);
        (event as unknown as {button: Gdk.EventButton}).button.button = 3;
        assert(emitEvent(button(), 'button-press-event', event), 'Right click is consumed by the task');
    };
    try {
        render([first]); window.show_all(); await wait();
        assert(popup(), 'Task owns a popup');
        rightClick(); assert(popup().get_visible(), 'Right click opens the task menu');
        click('panel-window-minimize-31'); assert(calls.pop() === 'minimize:31', 'Minimize targets the exact window');
        rightClick(); click('panel-window-maximize-31'); assert(calls.pop() === 'maximize:31', 'Maximize targets the exact window');
        rightClick(); click('panel-window-close-31'); assert(calls.pop() === 'close:31', 'Close targets the exact window');
        render([{...first, minimized: true}]); await wait(); rightClick(); click('panel-window-minimize-31');
        assert(calls.pop() === 'activate:31', 'A minimized single window offers Restore');
        render([first, second]); await wait(); rightClick();
        assert(all().some(widget => widget.name === 'panel-window-31') && all().some(widget => widget.name === 'panel-window-32'), 'Grouped windows have separate rows');
        assert(!(all().find(widget => widget.name === 'panel-window-minimize-32') as Gtk.Button).sensitive, 'Already minimized rows cannot be minimized again');
        click('panel-window-maximize-32'); click('panel-window-close-31'); click('panel-window-32');
        assert(calls.join(',') === 'maximize:32,close:31,activate:32', 'Row controls do not activate or close the wrong window'); calls.length = 0;
        emitEvent(button(), 'enter-notify-event', Gdk.Event.new(Gdk.EventType.ENTER_NOTIFY)); await wait(500);
        assert(popup().get_visible() && !popup().get_modal(), 'Hover opens the same list without taking focus');
        emitEvent(button(), 'leave-notify-event', Gdk.Event.new(Gdk.EventType.LEAVE_NOTIFY));
        emitEvent(popup(), 'enter-notify-event', Gdk.Event.new(Gdk.EventType.ENTER_NOTIFY)); await wait(300);
        assert(popup().get_visible(), 'Pointer can move from the task into the list');
        const intoChild = Gdk.Event.new(Gdk.EventType.LEAVE_NOTIFY);
        (intoChild as unknown as {crossing: Gdk.EventCrossing}).crossing.detail = Gdk.NotifyType.INFERIOR;
        emitEvent(popup(), 'leave-notify-event', intoChild); await wait(300);
        assert(popup().get_visible(), 'Moving onto a row action keeps the list open');
        emitEvent(popup(), 'leave-notify-event', Gdk.Event.new(Gdk.EventType.LEAVE_NOTIFY)); await wait(600);
        assert(!popup().get_visible(), 'Hover list closes after leaving both surfaces');
        const [ok, x, y] = button().translate_coordinates(window, 1, 1);
        assert(ok && panelTaskAt(window, x, y) && !panelTaskAt(window, -1, -1), 'Panel context menu excludes task hit regions');
        emitEvent(button(), 'enter-notify-event', Gdk.Event.new(Gdk.EventType.ENTER_NOTIFY));
    } finally {root.unmount(); window.destroy(); await wait(500);}
    if (GLib.getenv('DEV_OS_TASK_MENU_NATIVE') === '1') {
        const app = new Gtk.Application({application_id: 'org.devos.TaskMenuFixture'}); app.register(null);
        const native = new Gtk.ApplicationWindow({application: app, title: 'Panel window controls fixture', default_width: 400, default_height: 240});
        const tracker = new Windows({memoryPolicy: false}); native.show_all(); native.present();
        const until = async (condition: () => boolean) => {for (let count = 0; count < 200; count++) {if (condition()) return; await wait();} throw new Error('Native window action did not arrive');};
        try {
            await until(() => tracker.state.some(item => item.title === 'Panel window controls fixture'));
            const id = tracker.state.find(item => item.title === 'Panel window controls fixture')!.id;
            tracker.minimize(id); await until(() => tracker.state.find(item => item.id === id)?.minimized === true);
            tracker.maximize(id); await until(() => {const state = tracker.state.find(item => item.id === id); return state?.maximized === true && !state.minimized;});
            tracker.maximize(id); await until(() => tracker.state.find(item => item.id === id)?.maximized === false);
            tracker.close(id); await until(() => !tracker.state.some(item => item.id === id));
            print('PASS: native minimize, maximize/restore and close through the Wayland window tracker');
        } finally {tracker.destroy();}
    }
    print('PASS: task context menu, per-window controls, hover/focus behavior and timer cleanup');
}
const loop = new GLib.MainLoop(null, false); let failure: unknown;
void verify().catch(error => {failure = error;}).finally(() => loop.quit()); loop.run(); if (failure) throw failure;
