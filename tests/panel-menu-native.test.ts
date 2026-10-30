import {testTheme} from './theme-helper.js';
// Use tools/test/background-menu-smoke.dev panel to provide a private compositor.
import {Gtk, Gdk, Gio, GLib, removeTree, type UIContext} from '@dev-os/core';
import {ROOT, DEFAULTS} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {Panel} from '../packages/compat/panel-legacy/index.js';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
Gtk.init(null);
const temporary = GLib.getenv('DEV_OS_PANEL_MENU_TEST');
if (!temporary) throw new Error('Use the private panel menu smoke harness.');
const directory = temporary;
const preferences = new ExtensionManager({system: `${ROOT}/src/apps`, components: `${ROOT}/src/system`, bundled: `${ROOT}/src/extensions`, user: `${directory}/packages`, preferences: `${directory}/preferences`});
const customId = 'custom-native-panel';
const edge = GLib.getenv('DEV_OS_PANEL_EDGE') === 'bottom' ? 'bottom' : 'top';
preferences.update('org.devos.panel', true, {position: edge, height: 44, menuTerminal: false, contextCustomItems: JSON.stringify([{id: customId, title: 'Native panel test', command: `/usr/bin/touch "${directory}/command-ran"`, target: 'background', enabled: true}])});
const display = Gdk.Display.get_default()!, application = new Gtk.Application({application_id: 'org.devos.PanelNativeTest'});
application.register(null);
const theme = new Gtk.CssProvider();
theme.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme()) + '\nwindow#panel { background: #1a202a; border-radius: 12px; }'));
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
let invoked = '', launched = 0;
const context: UIContext = {application, display, preferences, config: () => DEFAULTS, saveCore() {}, monitors: () => [display.get_monitor(0)!],
    runCommand: () => {launched++; return true;}, reload: () => true, quit() {}, invoke: command => {invoked = command;},
    registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {}};
const panel = new Panel(context, display.get_monitor(0)!);
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
function menu() {return Gtk.Window.list_toplevels().flatMap(widgets).find(widget => widget.name === 'panel-context-menu' && widget.visible) as Gtk.Menu | undefined;}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function until(check: () => boolean, description: string) {for (let i = 0; i < 100; i++) {if (check()) return; await wait();} throw new Error(description);}
async function verify() {
    await wait();
    const clock = widgets(panel.window).find(widget => widget.name === 'panel-clock') as Gtk.Button;
    clock.clicked();
    for (let i = 0; i < 6; i++) await wait();
    const capture = Gio.Subprocess.new(['grim', `${ROOT}/build/panel-menu-native/clock-${edge}.png`], Gio.SubprocessFlags.NONE);
    await new Promise<void>((resolve, reject) => capture.wait_check_async(null, (_source, result) => {try {capture.wait_check_finish(result); resolve();} catch (error) {reject(error);}}));
    const pixels = GdkPixbuf.Pixbuf.new_from_file(`${ROOT}/build/panel-menu-native/clock-${edge}.png`), bytes = pixels.get_pixels();
    const pixel = (x: number, y: number) => {
        const offset = y * pixels.get_rowstride() + x * pixels.get_n_channels();
        return Math.max(...bytes.slice(offset, offset + 3));
    };
    if (pixel(pixels.get_width() - 120, edge === 'top' ? 130 : pixels.get_height() - 150) < 10) throw new Error('Clock popup did not paint');
    // This column is inside the native popup surface's transparent margin,
    // outside its rounded contents. The old panel repaint colored it dark blue.
    for (let y = 46; y < pixels.get_height() - 46; y++) {
        if (pixel(pixels.get_width() - 305, y) > 8) throw new Error('Panel background protrudes behind clock popup');
    }
    clock.clicked(); for (let i = 0; i < 5; i++) await wait();
    const profile = widgets(panel.window).find(widget => widget.name === 'panel-switch-user') as Gtk.Button;
    if ((profile.get_parent() as Gtk.Container).get_children().at(-1) !== profile) throw new Error('Profile is not the rightmost panel item');
    profile.clicked(); for (let i = 0; i < 8; i++) await wait();
    if (invoked) throw new Error('Profile button invoked a separate window instead of showing its popup');
    const profileCapture = Gio.Subprocess.new(['grim', `${ROOT}/build/panel-menu-native/profile-${edge}.png`], Gio.SubprocessFlags.NONE);
    await new Promise<void>((resolve, reject) => profileCapture.wait_check_async(null, (_source, result) => {try {profileCapture.wait_check_finish(result); resolve();} catch (error) {reject(error);}}));
    const profilePixels = GdkPixbuf.Pixbuf.new_from_file(`${ROOT}/build/panel-menu-native/profile-${edge}.png`);
    const profileOffset = (edge === 'top' ? 130 : profilePixels.get_height() - 150) * profilePixels.get_rowstride() + (profilePixels.get_width() - 120) * profilePixels.get_n_channels();
    if (Math.max(...profilePixels.get_pixels().slice(profileOffset, profileOffset + 3)) < 10) throw new Error('Profile popup did not paint above/below the panel');
    profile.clicked(); for (let i = 0; i < 5; i++) await wait();
    GLib.file_set_contents(`${directory}/ready`, `20 ${edge === 'top' ? 20 : display.get_monitor(0)!.get_geometry().height - 20}`);
    await until(() => Boolean(menu()), 'Real right-click did not open the panel menu');
    if (invoked || launched) throw new Error('Right-click triggered a normal panel button');
    const native = menu()!;
    if (native.get_children().some(widget => widget.name === 'panel-menu-menuTerminal')) throw new Error('Hidden default appeared');
    (native.get_children().find(widget => widget.name === 'panel-menu-menuPanelSettings') as Gtk.MenuItem).activate();
    await until(() => String(invoked) === 'settings.panel', 'Panel settings command was not routed');
    (native.get_children().find(widget => widget.name === 'panel-menu-menuClockSettings') as Gtk.MenuItem).activate();
    await until(() => String(invoked) === 'settings.clock', 'Clock settings command was not routed');
    (native.get_children().find(widget => widget.name === `panel-menu-${customId}`) as Gtk.MenuItem).activate();
    await until(() => Gio.File.new_for_path(`${directory}/command-ran`).query_exists(null), 'Panel custom command did not run');
    preferences.update('org.devos.panel', true, {contextEnabled: false});
    GLib.file_set_contents(`${directory}/disabled-ready`, 'ready');
    await until(() => Gio.File.new_for_path(`${directory}/clicked-disabled`).query_exists(null), 'Disabled menu click was not sent');
    for (let i = 0; i < 10; i++) await wait();
    if (menu()) throw new Error('Disabled panel menu still opened');
    print('PASS: real Wayland panel right-click, settings routes, custom command and master switch');
    GLib.file_set_contents(`${directory}/passed`, 'passed');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error; GLib.file_set_contents(`${directory}/failed`, String(error));}).finally(() => loop.quit());
loop.run(); panel.destroy(); preferences.dispose(); removeTree(`${directory}/preferences`); if (failed) throw failed;
