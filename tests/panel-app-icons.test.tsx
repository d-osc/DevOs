import {Gtk, Gdk, GLib} from '@dev-os/core';
import {windowGroup, builtinWindowApp, type DesktopWindow} from '@dev-os/services/windows';
import {mountPanel} from '../extensions/org.devos.panel/view.js';
import {panelOptions} from '../extensions/org.devos.panel/options.js';

Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const cases = [
    ['Terminal · project', 'terminal', 'dev-os-terminal-symbolic'], ['Dev OS Files · /home/test', 'files', 'dev-os-files-symbolic'],
    ['Dev OS Settings', 'settings', 'dev-os-settings-symbolic'], ['Dev OS Editor · main.ts', 'dev-os-editor', 'dev-os-editor-symbolic'],
    ['Browser · Example Domain', 'dev-os-browser', 'dev-os-browser-symbolic'], ['Camera', 'dev-os-camera', 'dev-os-camera-symbolic'],
    ['Microphone', 'dev-os-microphone', 'dev-os-microphone-symbolic'], ['Task Manager', 'dev-os-task-manager', 'dev-os-task-manager-symbolic'],
    ['Disk Manager', 'dev-os-disk-manager', 'dev-os-disk-manager-symbolic'], ['App Store', 'dev-os-app-store', 'dev-os-app-store-symbolic'],
    ['Install Dev OS', 'dev-os-installer', 'dev-os-installer-symbolic'], ['Developer Tools', 'dev-os-browser-inspector', 'dev-os-editor-symbolic'],
] as const;
// GTK3 reports "gjs" on the real Wayland session, even for Gtk.ApplicationWindow.
const state: DesktopWindow[] = cases.map(([title], index) => ({id: index + 1, title, appId: 'gjs', active: false, minimized: false}));
for (const [index, [, group, icon]] of cases.entries()) {
    assert(windowGroup(state[index]!) === group, `${state[index]!.title} gets its own app group`);
    assert(builtinWindowApp(group)?.icon === icon, `${group} gets its own assets/ icon`);
}
assert(windowGroup({...state[4]!, title: 'Dev OS Browser · Old window'}) === 'dev-os-browser', 'Legacy Browser title remains supported');
assert(windowGroup({...state[4]!, title: 'Camera', appId: 'org.example.ExternalBrowser'}) === 'org.example.ExternalBrowser', 'External page titles cannot impersonate built-in apps');
const window = new Gtk.Window({default_width: 1000, default_height: 48});
const panel = mountPanel(window, {config: {name: 'Dev OS', clock_format: '%H:%M'}, options: panelOptions({showPinned: false}),
    launcher: {toggle() {}}, runCommand: () => true,
    windows: {state, subscribe: () => () => {}, activate() {}, toggle() {}}}, Gdk.Display.get_default()!.get_monitor(0)!);
const loop = new GLib.MainLoop(null, false); let failed: unknown;
window.show_all();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
    try {
        for (const [index, [, , icon]] of cases.entries()) {
            const button = widgets(window).find(widget => widget.name === `panel-task-${index + 1}`);
            assert(button, `Distinct panel button for ${cases[index]![0]}`);
            const image = widgets(button!).find(widget => widget instanceof Gtk.Image) as Gtk.Image;
            assert(image.get_icon_name()[0] === icon, `${cases[index]![0]} renders ${icon}, without stale desktop metadata`);
        }
        print('PASS: All built-in panel apps have distinct groups and matching icons; external titles stay external');
    } catch (error) {failed = error;}
    finally {panel.root.unmount(); window.destroy(); loop.quit();}
    return GLib.SOURCE_REMOVE;
});
loop.run(); if (failed) throw failed;
