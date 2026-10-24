import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Gio, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {PanelSettings} from '../extensions/org.devos.panel/settings-view.js';
import {panelOptions} from '../extensions/org.devos.panel/options.js';
import {mountPanel} from '../extensions/org.devos.panel/view.js';
import {preparePanelAppearance} from '../extensions/org.devos.panel/appearance.js';
import {panelMenuItems, createPanelMenu, type PanelMenuKey} from '../extensions/org.devos.panel/context-menu.js';
import {parseCustomMenu} from '../extensions/org.devos.files/custom-menu.js';

Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    assert(panelOptions({height: 0}, 52).height === 52, 'Default height follows Desktop');
    assert(panelOptions({height: 120, iconSize: 100, spacing: -20}).height === 96 && panelOptions({iconSize: 100}).iconSize === 28 && panelOptions({spacing: -20}).spacing === 0, 'Sizes are bounded');
    const temporary = GLib.dir_make_tmp('devos-panel-ui-XXXXXX');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(760, 1100);
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const theme = new Gtk.CssProvider(); theme.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(container).find(widget => widget.name === id) as T;
    let applied = 0;
    try {
        root.render(<PanelSettings preferences={preferences} getConfig={() => ({panel_height: 52})} applied={() => {applied++;}} />); await wait();
        assert(find<Gtk.SpinButton>('panel-height').get_value_as_int() === 52 && !find('panel-height').sensitive, 'Follow mode shows actual Desktop height');
        find<Gtk.Button>('panel-position-top').emit('clicked'); find<Gtk.Button>('panel-preset-44').emit('clicked');
        find<Gtk.Switch>('panel-showDate').set_active(false); find<Gtk.Switch>('panel-showPinned').set_active(false);
        assert(!find('panel-preview-date') && !find('panel-preview-pins'), 'Draft toggles update preview');
        assert(preferences.get('org.devos.panel').state.values.position === 'bottom', 'Preview does not save before Apply');
        find<Gtk.Button>('panel-settings-apply').emit('clicked');
        const saved = preferences.get('org.devos.panel').state.values;
        assert(applied === 1 && saved.position === 'top' && saved.height === 44 && !saved.showPinned && !saved.showDate, 'Apply saves and reloads');
        find<Gtk.Switch>('panel-follow-height').set_active(true); find<Gtk.Button>('panel-settings-reset').emit('clicked');
        assert(!find<Gtk.Switch>('panel-follow-height').active, 'Reset restores saved height');
        find<Gtk.Switch>('panel-option-menuTerminal').set_active(false);
        assert(!find('panel-preview-menuTerminal') && preferences.get('org.devos.panel').state.values.menuTerminal === true, 'Panel menu preview is isolated');
        find<Gtk.Entry>('files-custom-title').set_text('My panel action'); find<Gtk.Entry>('files-custom-command').set_text('my-app "{directory}"');
        find<Gtk.Button>('files-custom-save').emit('clicked'); find<Gtk.Button>('panel-settings-apply').emit('clicked');
        const menuValues = preferences.get('org.devos.panel').state.values, custom = parseCustomMenu(menuValues.contextCustomItems);
        assert(applied === 2 && !menuValues.menuTerminal && menuValues.height === 44 && custom.length === 1, 'Apply preserves panel dimensions and saves menu actions');
        assert(preferences.get('org.devos.background').state.values.contextCustomItems === '[]', 'Panel menu preferences are separate from Background');
        let invoked = '';
        const actions = Object.fromEntries(panelMenuItems.map(item => [item.key, () => {invoked = item.key;}])) as Record<PanelMenuKey, () => void>;
        const nativeMenu = createPanelMenu(menuValues, actions, item => {invoked = item.id;});
        assert(!nativeMenu.get_children().some(item => item.name === 'panel-menu-menuTerminal'), 'Hidden default is absent from actual menu');
        (nativeMenu.get_children().find(item => item.name === 'panel-menu-menuPanelSettings') as Gtk.MenuItem).activate();
        assert(invoked === 'menuPanelSettings', 'Panel settings action dispatches');
        (nativeMenu.get_children().find(item => item.name === `panel-menu-${custom[0].id}`) as Gtk.MenuItem).activate();
        assert(invoked === custom[0].id, 'Custom panel action dispatches'); nativeMenu.destroy();
        find<Gtk.Switch>('panel-context-enabled').set_active(false); find<Gtk.Button>('panel-settings-reset').emit('clicked');
        assert(find<Gtk.Switch>('panel-context-enabled').active, 'Reset restores menu enablement');
        const disabled = createPanelMenu({...menuValues, contextEnabled: false}, actions, () => {});
        assert(!disabled.get_children().length, 'Master switch disables native panel menu'); disabled.destroy();
        find<Gtk.Button>(`files-custom-delete-${custom[0].id}`).emit('clicked'); find<Gtk.Button>('panel-settings-apply').emit('clicked');
        assert(panelMenuItems.every(item => find(`panel-option-${item.key}`)) && parseCustomMenu(preferences.get('org.devos.panel').state.values.contextCustomItems).length === 0, 'Custom removal cannot remove default actions');
        find<Gtk.Switch>('panel-showDate').set_active(true); find<Gtk.Switch>('panel-showPinned').set_active(true);
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (screenshot) {
            window.show_all(); await wait(); window.get_pixbuf()!.savev(screenshot, 'png', [], []);
            const scroll = widgets(container).find(widget => widget instanceof Gtk.ScrolledWindow) as Gtk.ScrolledWindow;
            scroll.get_vadjustment().set_value(1000); await wait(); window.get_pixbuf()!.savev(screenshot.replace('.png', '-context.png'), 'png', [], []);
        }
    } finally {
        root.unmount(); window.destroy(); preferences.dispose();
        for (const relative of ['preferences/org.devos.panel.json', 'preferences', '']) {const file = Gio.File.new_for_path(`${temporary}/${relative}`); if (file.query_exists(null)) file.delete(null);}
    }
    for (const position of ['top', 'bottom'] as const) {
        const native = new Gtk.OffscreenWindow(); let toggled = 0, menu = 0, taskView = 0;
        const visual = native.get_screen()!.get_rgba_visual(); if (visual) native.set_visual(visual);
        preparePanelAppearance(native); native.set_size_request(760, 44);
        if (position === 'top') native.get_style_context().add_class('panel-top');
        const panel = mountPanel(native, {config: {name: 'Dev OS', clock_format: '%H:%M'}, options: panelOptions({position, showPinned: false, showDate: false, iconSize: 24}),
            launcher: {toggle: () => {menu++;}}, runCommand: () => true,
            toggleTaskView: () => {taskView++;},
            windows: {state: [{id: 1, title: 'Dev OS Terminal', appId: 'terminal', active: true, minimized: false}], subscribe: () => () => {}, activate: () => {}, toggle: () => {toggled++;}}}, Gdk.Display.get_default()!.get_primary_monitor()!);
        try {
            await wait(); const children = widgets(native);
            assert(!children.some(widget => widget.name === 'panel-terminal'), 'Pinned launch shortcut is hidden');
            const task = children.find(widget => widget.name === 'panel-task-1') as Gtk.Button; task.emit('clicked');
            const overview = children.find(widget => widget.name === 'panel-task-view') as Gtk.Button;
            overview.emit('clicked');
            assert(taskView === 1 && children.indexOf(overview) < children.indexOf(task), 'Task View button activates before Terminal and remains available when pins are hidden');
            assert(toggled === 1, 'Running terminal remains accessible when shortcuts are hidden');
            assert(!children.some(widget => widget.get_style_context().has_class('clock-date')), 'Date can be hidden on the real panel');
            assert(children.some(widget => widget.name === 'panel-devices') && children.some(widget => widget.name === 'panel-alert'), 'System controls remain available');
            const button = children.find(widget => widget.name === 'panel-menu') as Gtk.Button; button.emit('clicked');
            assert(menu === 1 && (button.get_child() as Gtk.Image).pixel_size === 24, 'Menu action and icon size work');
            native.show(); await wait();
            const pixbuf = native.get_pixbuf()!;
            const pixels = pixbuf.get_pixels(), channels = pixbuf.n_channels;
            assert(pixbuf.has_alpha && pixels[3] < pixels[20 * channels + 3], 'Real panel corners are transparent while its body is painted');
            const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
            if (screenshot) pixbuf.savev(screenshot.replace('.png', `-${position}.png`), 'png', [], []);
        } finally {panel.root.unmount(); await wait(); native.destroy();}
    }
    print('PASS: panel defaults, preview, Apply/Reset, both positions, transparent rounded corners, icon size, hidden shortcuts and running tasks');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
