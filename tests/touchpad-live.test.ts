// Verify gesture window actions over the real compositor's toplevel protocol.
import {Gtk, GLib} from '@dev-os/core';
import {Windows, gestureWindowTarget} from '@dev-os/services/windows';
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 70, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function until(check: () => boolean, message: string) {for (let i = 0; i < 100; i++) {if (check()) return; await wait();} throw new Error(message);}
async function verify() {
    Gtk.init(null); const tracker = new Windows();
    const first = new Gtk.Window({title: 'DevOs gesture fixture 1', default_width: 280, default_height: 160});
    const second = new Gtk.Window({title: 'DevOs gesture fixture 2', default_width: 280, default_height: 160});
    let original: number | undefined;
    try {
        await wait(); original = tracker.state.find(window => window.active)?.id;
        first.show_all(); second.show_all();
        await until(() => tracker.state.filter(window => window.title.startsWith('DevOs gesture fixture')).length === 2, 'Tracker did not find gesture fixtures');
        const id = tracker.state.find(window => window.title === 'DevOs gesture fixture 2')!.id;
        second.iconify(); await until(() => tracker.state.some(window => window.id === id && window.minimized), 'Fixture failed to minimize');
        tracker.gesture('restore'); await until(() => tracker.state.some(window => window.id === id && window.active && !window.minimized), 'Gesture failed to restore the most recent minimized window');
        const desktop = tracker.desktops.find(desktop => desktop.active)?.id;
        for (const action of ['next', 'previous'] as const) {
            const target = gestureWindowTarget(tracker.state, desktop, action)!;
            tracker.gesture(action); await until(() => tracker.state.some(window => window.id === target.id && window.active && !window.minimized), `Gesture ${action} failed to activate its target`);
        }
        print('PASS: real compositor minimized-window restore and next/previous window actions');
    } finally {first.destroy(); second.destroy(); if (original !== undefined) tracker.activate(original); await wait(); tracker.destroy();}
}
if (GLib.getenv('DEVOS_TOUCHPAD_INTEGRATION') === '1') {const loop = new GLib.MainLoop(null, false); let failed: unknown; void verify().catch(reason => {failed = reason;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;}
else print('SKIP: opt-in real window action test');
