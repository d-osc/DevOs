import {testTheme} from './theme-helper.js';
import {Gtk, Gdk, Gio, GLib, type UIContext} from '@dev-os/core';
import {ROOT, DEFAULTS} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {Launcher} from '../extensions/org.devos.launcher/index.js';
import {TaskView} from '../extensions/org.devos.launcher/task-view.js';
Gtk.init(null);
const directory = GLib.getenv('DEV_OS_LAUNCHER_TEST');
if (!directory) throw new Error('Use tools/test/launcher-smoke.dev');
const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${directory}/packages`, preferences: `${directory}/preferences`});
const display = Gdk.Display.get_default()!, monitor = display.get_monitor(0)!;
const application = new Gtk.Application({application_id: 'org.devos.LauncherNativeTest'}); application.register(null);
const theme = new Gtk.CssProvider();
// Load through the same accent substitution as the shell.
theme.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
const context: UIContext = {application, display, preferences, config: () => DEFAULTS, saveCore() {}, monitors: () => [monitor], runCommand: () => true, reload: () => true, quit() {}, invoke() {}, registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {}};
const launcher = new Launcher(context);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function until(check: () => boolean) {for (let i = 0; i < 150; i++) {if (check()) return; await wait();} throw new Error('Launcher operation timed out');}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
function command(argv: string[]) {return new Promise<void>((resolve, reject) => {
    const process = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    process.wait_check_async(null, (_source, result) => {try {process.wait_check_finish(result); resolve();} catch (error) {reject(error);}});
});}
async function verify() {
    const keyboard = Gio.Subprocess.new(['wtype', '-s', '20000'], Gio.SubprocessFlags.NONE);
    for (let i = 0; i < 5; i++) await wait();
    launcher.show(monitor);
    const surface = () => widgets(launcher.window).find(widget => widget.get_style_context().has_class('overlay-motion-content'))!;
    if (Gtk.Settings.get_default()!.gtk_enable_animations) {
        await until(() => surface().get_opacity() > 0.05 && surface().get_opacity() < 0.95);
        await command(['grim', `${ROOT}/build/launcher-native/opening.png`]);
        await until(() => surface().get_opacity() === 1);
    }
    const geometry = monitor.get_geometry();
    await until(() => launcher.window.get_allocated_width() === geometry.width && launcher.window.get_allocated_height() === geometry.height);
    const search = widgets(launcher.window).find(widget => widget.name === 'launcher-search') as Gtk.SearchEntry;
    search.set_text('devos-no-such-application-xyz'); await wait();
    if (!widgets(launcher.window).some(widget => widget instanceof Gtk.Label && widget.get_text() === 'No applications found')) throw new Error('Empty search is broken');
    search.set_text(''); for (let i = 0; i < 10; i++) await wait();
    await command(['grim', `${ROOT}/build/launcher-native/fullscreen.png`]);
    (widgets(launcher.window).find(widget => widget.name === 'launcher-workspace-add') as Gtk.Button).clicked();
    const pin = widgets(launcher.window).find(widget => widget.name === 'launcher-pin-0') as Gtk.Button | undefined;
    if (pin) pin.clicked();
    (widgets(launcher.window).find(widget => widget.name === 'launcher-view-grid') as Gtk.Button).clicked();
    for (let i = 0; i < 5; i++) await wait();
    if (!widgets(launcher.window).some(widget => widget.name === 'launcher-app-grid')) throw new Error('Native grid did not render');
    if (launcher.window.get_allocated_height() !== geometry.height) throw new Error('Editing Workspace exceeds screen height');
    await command(['grim', `${ROOT}/build/launcher-native/grid.png`]);
    await command(['wtype', '-k', 'Escape']);
    await until(() => !launcher.window.get_visible());
    const taskView = new TaskView(context);
    try {
        const taskSurface = () => widgets(taskView.window).find(widget => widget.get_style_context().has_class('overlay-motion-content'))!;
        taskView.show(monitor);
        if (Gtk.Settings.get_default()!.gtk_enable_animations) {
            await until(() => taskSurface().get_opacity() > 0.05 && taskSurface().get_opacity() < 0.95);
            await command(['grim', `${ROOT}/build/launcher-native/task-view-opening.png`]);
        }
        await until(() => taskSurface().get_opacity() === 1);
        taskView.hide(); await wait(); taskView.show(monitor);
        await until(() => taskView.window.visible && taskSurface().get_opacity() === 1);
        if (!widgets(taskView.window).some(widget => widget.name === 'task-view-dismiss')) throw new Error('Reopening Task View lost its contents');
        taskView.hide(); await until(() => !taskView.window.visible);
        const settings = Gtk.Settings.get_default()!, enabled = settings.gtk_enable_animations;
        try {
            settings.gtk_enable_animations = false;
            taskView.show(monitor);
            if (taskSurface().get_opacity() !== 1) throw new Error('Disabled animations must show instantly');
            taskView.hide();
            if (taskView.window.visible) throw new Error('Disabled animations must hide instantly');
        } finally {settings.gtk_enable_animations = enabled;}
    } finally {taskView.destroy();}
    keyboard.force_exit();
    launcher.show(); await until(() => launcher.window.get_visible());
    await until(() => surface().get_opacity() === 1);
    launcher.toggle(); await wait(); launcher.toggle();
    await until(() => launcher.window.get_visible() && surface().get_opacity() === 1);
    (widgets(launcher.window).find(widget => widget.name === 'launcher-close') as Gtk.Button).clicked();
    await until(() => !launcher.window.get_visible());
    print('PASS: fullscreen monitor dimensions, search, real Escape, reopen and close button');
    GLib.file_set_contents(`${directory}/passed`, 'passed');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run();
launcher.destroy(); preferences.dispose(); if (failed) throw failed;
