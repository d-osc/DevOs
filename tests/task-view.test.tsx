import {React, Gtk, Gdk, GLib, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {TaskViewLive} from '../extensions/org.devos.launcher/task-view.js';
import type {DesktopWindow, DesktopWorkspace, WindowControls} from '@dev-os/services/windows';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    const listeners = new Set<() => void>(); let activated = 0, closed = 0, dismissed = 0;
    let desktops: DesktopWorkspace[] = [], moved = 0;
    let state: DesktopWindow[] = [
        {id: 1, title: 'Dev OS Terminal · build', appId: 'terminal', active: true, minimized: false},
        {id: 2, title: 'Dev OS Files · Projects', appId: 'files', active: false, minimized: false},
        {id: 3, title: 'Dev OS Settings', appId: 'settings', active: false, minimized: true},
        {id: 4, title: 'Dev OS Editor · main.ts', appId: 'editor', active: false, minimized: false},
    ];
    const controls: WindowControls = {get state() {return state;}, get desktops() {return desktops;}, subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};},
        canCreateDesktop: true,
        canRemoveDesktop: true,
        removeDesktop: id => {if (desktops.length <= 1) return; const target = id > 1 ? id - 1 : 2; state = state.map(window => ({...window, desktop: window.desktop === id ? target : window.desktop})); desktops = desktops.filter(desktop => desktop.id !== id).map(desktop => ({...desktop, active: desktop.id === target})); listeners.forEach(listener => listener());},
        createDesktop: () => {const id = desktops.length + 1; desktops = [...desktops.map(desktop => ({...desktop, active: false})), {id, name: String(id), active: true}]; listeners.forEach(listener => listener());},
        activate: id => {assert(dismissed > 0, 'Overview hides before activating a window'); activated = id;}, toggle() {},
        close: id => {closed = id; state = state.filter(window => window.id !== id); listeners.forEach(listener => listener());},
        switchDesktop: id => {desktops = desktops.map(desktop => ({...desktop, active: desktop.id === id})); listeners.forEach(listener => listener());},
        moveToDesktop: (id, desktop) => {moved = id; state = state.map(window => window.id === id ? {...window, desktop} : window); listeners.forEach(listener => listener());}};
    const window = new Gtk.OffscreenWindow(); window.name = 'task-view'; window.set_size_request(1200, 780);
    const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replaceAll('@ACCENT@', '#88e0c0')));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    try {
        root.render(<TaskViewLive controls={controls} dismiss={() => {dismissed++;}} />); window.show_all(); await wait();
        assert(widgets(window).filter(widget => widget.name.startsWith('task-view-activate-')).length === 4, 'Every tracked window has its own card');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        find<Gtk.Button>('task-view-activate-3').emit('clicked'); assert(activated === 3, 'Minimized window can be selected');
        find<Gtk.Button>('task-view-close-2').emit('clicked'); assert(closed === 2 && !find('task-view-activate-2'), 'Closing sends a polite window request and updates cards live');
        state = []; listeners.forEach(listener => listener()); await wait(); assert(find('task-view-empty'), 'Last closed window produces the empty state');
        find<Gtk.Button>('task-view-dismiss').emit('clicked'); assert(dismissed === 2, 'Dismiss button works');
        desktops = [1, 2, 3, 4].map(id => ({id, name: String(id), active: id === 1}));
        state = [{id: 10, title: 'Dev OS Files · Desktop One', appId: 'files', active: false, minimized: false, desktop: 1},
            {id: 11, title: 'Dev OS Terminal · Desktop Two', appId: 'terminal', active: false, minimized: true, desktop: 2}];
        listeners.forEach(listener => listener()); await wait();
        assert(find('task-view-activate-10') && !find('task-view-activate-11') && find('task-view-desktop-4'), 'Task View separates real desktop memberships and lists desktop buttons');
        if (screenshot) {await wait(); window.get_pixbuf()!.savev(screenshot.replace('.png', '-desktops.png'), 'png', [], []);}
        find<Gtk.Button>('task-view-desktop-2').emit('clicked'); await wait();
        assert(!find('task-view-activate-10') && find('task-view-activate-11') && find<Gtk.Label>('task-view-desktop-title').get_text().includes('Desktop 2'), 'Selecting a desktop switches and updates its windows');
        find<Gtk.ComboBoxText>('task-view-move-11').set_active_id('1'); await wait();
        assert(moved === 11 && !find('task-view-activate-11') && find('task-view-empty'), 'Moving a window to another desktop updates the current view');
        find<Gtk.Button>('task-view-create-desktop').emit('clicked'); await wait();
        assert(desktops.length === 5 && desktops[4].active && find('task-view-desktop-5') && find<Gtk.Label>('task-view-desktop-title').get_text().includes('Desktop 5'), 'New desktop creates, activates and updates the strip');
        find<Gtk.Button>('task-view-create-desktop').emit('clicked'); await wait();
        assert(desktops.length === 6 && desktops[5].active && find('task-view-desktop-6'), 'More desktops can be added repeatedly');
        find<Gtk.Button>('task-view-remove-desktop').emit('clicked'); await wait();
        assert(desktops.length === 5 && !find('task-view-desktop-6') && desktops[4].active, 'Remove desktop deletes the current desktop and activates its neighbor');
        while (desktops.length > 1) {find<Gtk.Button>('task-view-remove-desktop').emit('clicked'); await wait();}
        assert(!find<Gtk.Button>('task-view-remove-desktop').get_sensitive(), 'Remove is disabled for the final desktop');
    } finally {root.unmount(); window.destroy(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css);}
    assert(listeners.size === 0, 'Unmount releases the tracker subscription');
    print('PASS: Task View cards, live close/update, desktop filtering/switching/moving, empty state and cleanup');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
