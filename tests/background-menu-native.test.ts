// Run only in the private headless session created by background-menu-smoke.dev.
import {Gtk, Gdk, Gio, GLib, removeTree, type UIContext} from '@dev-os/core';
import {ROOT, DEFAULTS} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {Background} from '../packages/compat/background-legacy/index.js';
import {Windows} from '@dev-os/services/windows';
import {activeWidgetDesktop, desktopWidgetValues, updateDesktopWidgets} from '../packages/compat/background-legacy/widget-desktops.js';
Gtk.init(null);
const temporary = GLib.getenv('DEV_OS_BACKGROUND_MENU_TEST');
if (!temporary) throw new Error('Use the private background-menu smoke harness.');
const directory = temporary;
const preferences = new ExtensionManager({system: `${ROOT}/src/apps`, components: `${ROOT}/src/system`, bundled: `${ROOT}/src/extensions`, user: `${directory}/packages`, preferences: `${directory}/preferences`});
const customId = 'custom-native-test';
preferences.update('org.devos.background', true, {mode: 'design', style: 'flow', menuReload: false, contextCustomItems: JSON.stringify([{id: customId, title: 'Native custom test', command: `/usr/bin/touch "${directory}/command-ran"`, target: 'background', enabled: true}])});
preferences.update('org.devos.background', true, {...preferences.get('org.devos.background').state.values, widgetClock: true, widgetDate: true, widgetNote: true, widgetPosition: 'left', widgetNoteText: 'Native widget test'});
const display = Gdk.Display.get_default()!, application = new Gtk.Application({application_id: 'org.devos.BackgroundNativeTest'});
application.register(null);
let invoked = '';
const controls = new Windows();
const currentWidgets = () => desktopWidgetValues(preferences.get('org.devos.background').state.values, activeWidgetDesktop(controls));
const context: UIContext = {application, display, preferences, config: () => DEFAULTS, saveCore() {}, monitors: () => [display.get_monitor(0)!],
    windows: controls, runCommand: () => true, reload: () => true, quit() {}, invoke: command => {invoked = command;},
    registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {}};
let background = new Background(context, display.get_monitor(0)!, DEFAULTS);
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
function menu() {return Gtk.Window.list_toplevels().flatMap(widgets).find(widget => widget.name === 'background-context-menu' && widget.visible) as Gtk.Menu | undefined;}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function until(check: () => boolean, description: string) {for (let i = 0; i < 100; i++) {if (check()) return; await wait();} throw new Error(description);}
async function verify() {
    await wait();
    await until(() => {
        const clock = widgets(background.window).find(widget => widget.name === 'desktop-widget-clock');
        return Boolean(clock?.get_mapped() && clock.get_allocated_height() > 1 && background.window.get_allocated_height() > 200);
    }, 'Desktop clock widget is not visible');
    const card = () => widgets(background.window).find(widget => widget.name === 'desktop-widget-clock')!;
    const handle = widgets(background.window).find(widget => widget.name === 'desktop-drag-widgetClock')!;
    await until(() => handle.translate_coordinates(background.window, 0, 0)[2] >= 80, 'Widget placement has not settled');
    const [translated, hx, hy] = handle.translate_coordinates(background.window, 10, 8);
    if (!translated) throw new Error('Cannot locate widget drag handle');
    const original = {x: card().margin_start, y: card().margin_top};
    let unmapped = 0;
    const trackedCard = card();
    const mapping = trackedCard.connect('unmap', () => unmapped++);
    GLib.file_set_contents(`${directory}/drag-ready`, `${hx} ${hy}`);
    await until(() => Gio.File.new_for_path(`${directory}/dragged`).query_exists(null), 'Drag input was not sent');
    await until(() => String(currentWidgets().widgetLocations).includes('widgetClock'), 'Dragging did not persist a position');
    trackedCard.disconnect(mapping);
    if (unmapped || card() !== trackedCard) throw new Error(`Dragging remapped/replaced widget ${unmapped} times`);
    if (Math.abs(card().margin_start - original.x - 200) > 2 || Math.abs(card().margin_top - original.y - 100) > 2) throw new Error('Widget did not follow the pointer distance');
    const moved = {x: card().margin_start, y: card().margin_top};
    const persisted = new ExtensionManager({system: `${ROOT}/src/apps`, components: `${ROOT}/src/system`, bundled: `${ROOT}/src/extensions`, user: `${directory}/packages`, preferences: `${directory}/preferences`});
    if (persisted.get('org.devos.background').state.values.widgetDesktops !== preferences.get('org.devos.background').state.values.widgetDesktops) throw new Error('Position was not saved to disk');
    persisted.dispose();
    controls.switchDesktop(2);
    await until(() => controls.desktops.some(item => item.id === 2 && item.active) && !card(), 'Desktop 1 widgets followed to Desktop 2');
    const second = activeWidgetDesktop(controls)!;
    preferences.update('org.devos.background', true, updateDesktopWidgets(preferences.get('org.devos.background').state.values, second, {widgetNote: true, widgetNoteText: 'Desktop Two only'}));
    await until(() => widgets(background.window).some(widget => widget instanceof Gtk.Label && widget.get_text() === 'Desktop Two only'), 'Desktop 2 note did not appear');
    controls.switchDesktop(1);
    await until(() => controls.desktops.some(item => item.id === 1 && item.active) && Boolean(card()), 'Desktop 1 widget did not return');
    if (widgets(background.window).some(widget => widget instanceof Gtk.Label && widget.get_text() === 'Desktop Two only')) throw new Error('Desktop 2 note leaked to Desktop 1');
    background.destroy(); background = new Background(context, display.get_monitor(0)!, DEFAULTS);
    await until(() => Boolean(card()) && Math.abs(card().margin_start - moved.x) <= 1 && Math.abs(card().margin_top - moved.y) <= 1, 'Widget position did not survive reopening desktop');
    await wait();
    const remove = widgets(background.window).find(widget => widget.name === 'desktop-remove-widgetClock')!;
    const [, rx, ry] = remove.translate_coordinates(background.window, remove.get_allocated_width() / 2, remove.get_allocated_height() / 2);
    GLib.file_set_contents(`${directory}/remove-ready`, `${rx} ${ry}`);
    await until(() => currentWidgets().widgetClock === false, 'Remove button did not persist removal');
    if (widgets(background.window).some(widget => widget.name === 'desktop-widget-clock')) throw new Error('Removed clock is still on desktop');
    if (!widgets(background.window).some(widget => widget.name === 'desktop-widget-date')) throw new Error('Removing clock affected another widget');
    controls.switchDesktop(2);
    await until(() => controls.desktops.some(item => item.id === 2 && item.active), 'Cannot return to Desktop 2');
    if (currentWidgets().widgetNoteText !== 'Desktop Two only' || currentWidgets().widgetNote !== true) throw new Error('Removal on Desktop 1 changed Desktop 2');
    controls.switchDesktop(1);
    await until(() => controls.desktops.some(item => item.id === 1 && item.active), 'Cannot restore Desktop 1');
    GLib.file_set_contents(`${directory}/ready`, 'ready');
    await until(() => Boolean(menu()), 'Real right-click did not open the desktop menu');
    const native = menu()!;
    if (native.get_children().some(widget => widget.name === 'background-menu-menuReload')) throw new Error('Hidden default appeared');
    (native.get_children().find(widget => widget.name === 'background-menu-menuBackground') as Gtk.MenuItem).activate();
    if (invoked !== 'settings.background') throw new Error('Background settings command was not routed');
    invoked = '';
    (native.get_children().find(widget => widget.name === 'background-menu-menuWidgets') as Gtk.MenuItem).activate();
    if (invoked !== 'settings.background') throw new Error('Desktop widgets settings command was not routed');
    (native.get_children().find(widget => widget.name === `background-menu-${customId}`) as Gtk.MenuItem).activate();
    await until(() => Gio.File.new_for_path(`${directory}/command-ran`).query_exists(null), 'Desktop custom command did not run');
    preferences.update('org.devos.background', true, {contextEnabled: false});
    GLib.file_set_contents(`${directory}/disabled-ready`, 'ready');
    await until(() => Gio.File.new_for_path(`${directory}/clicked-disabled`).query_exists(null), 'Disabled menu click was not sent');
    for (let i = 0; i < 10; i++) await wait();
    if (menu()) throw new Error('Disabled menu still opened');
    print('PASS: real widget drag, saved position/reopen, direct removal, independent widgets and desktop right-click actions');
    GLib.file_set_contents(`${directory}/passed`, 'passed');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error; GLib.file_set_contents(`${directory}/failed`, String(error));}).finally(() => loop.quit());
loop.run(); background.destroy(); controls.destroy(); preferences.dispose(); removeTree(`${directory}/preferences`); if (failed) throw failed;
