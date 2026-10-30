import {Gtk, Gdk, GLib} from '@dev-os/core';
import {PanelTaskbar} from '../packages/compat/panel-taskbar.js';
import {mountPanel} from '../packages/compat/panel-legacy/view.js';
import type {DesktopWindow, WindowControls} from '@dev-os/services/windows';
Gtk.init(null);
function assert(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
const wait = (ms: number) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
async function verify() {
    let state: DesktopWindow[] = [{id: 21, title: 'Task Manager', appId: 'gjs', active: true, minimized: false}];
    const listeners = new Set<() => void>();
    const windows = {get state() {return state;}, subscribe(changed: () => void) {listeners.add(changed); return () => {listeners.delete(changed);};}, activate() {}, toggle() {}} as WindowControls;
    const first = new PanelTaskbar(windows, true), second = new PanelTaskbar(windows, true);
    const count = () => first.state.length, subscriptions = () => listeners.size;
    const native = new Gtk.Window({default_width: 1000, default_height: 48});
    const panel = mountPanel(native, {config: {name: 'Dev OS', clock_format: '%H:%M'}, taskbar: first, windows, launcher: {toggle() {}}, runCommand: () => true}, Gdk.Display.get_default()!.get_monitor(0)!);
    native.show_all();
    try {
        for (let i = 0; i < 300 && count() !== 3; i++) await wait(50);
        assert(count() === 3 && first.state === second.state, 'Monitors did not share one taskbar projection');
        const all = () => widgets(native);
        for (let i = 0; i < 300 && !all().find(widget => widget.name === 'panel-task-21')?.get_style_context().has_class('task-active'); i++) await wait(50);
        const task = all().find(widget => widget.name === 'panel-task-21');
        assert(task && task.get_style_context().has_class('task-active'), 'Prepared task state did not reach GTK');
        assert(all().some(widget => widget instanceof Gtk.Image && widget.icon_name === 'dev-os-task-manager-symbolic'), 'Native app icon changed');
        state = [{...state[0]!, active: false, minimized: true}, {id: 22, title: 'Second', appId: 'org.example.App', active: false, minimized: false}];
        for (const listener of listeners) listener();
        for (let i = 0; i < 300 && !first.state.some(row => row.id === 'panel-task-21' && row.minimized); i++) await wait(50);
        await wait(50);
        assert(all().find(widget => widget.name === 'panel-task-21')?.get_style_context().has_class('task-minimized'), 'Minimized update was lost');
        state = []; for (const listener of listeners) listener();
        for (let i = 0; i < 300 && count() !== 2; i++) await wait(50);
        await wait(50); assert(!all().some(widget => widget.name === 'panel-task-21'), 'Closed task remained on GTK');
        const before = subscriptions();
        first.destroy(); assert(subscriptions() === before, 'One monitor disposed the shared worker early');
        second.destroy(); assert(subscriptions() === before - 1, 'Last monitor leaked its window subscription');
        print('PASS shared DevLang taskbar projection renders builtin icons, live states/closure and releases after the final monitor');
    } finally {first.destroy(); second.destroy(); panel.root.unmount(); native.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
