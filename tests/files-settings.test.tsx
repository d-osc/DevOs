import {React, Gtk, Gdk, GLib, Gio, createRoot, removeTree} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {FilesSettings} from '../extensions/org.devos.files/settings-view.js';
import {fileMenuOptions, fileMenuItems, createFileContextMenu, fileContextEntry, type FileMenuKey} from '../extensions/org.devos.files/context-menu.js';
import {FileBrowser} from '../extensions/org.devos.files/model.js';
import {mountFiles} from '../extensions/org.devos.files/view.js';
import {parseCustomMenu, customCommandArguments, customMenuMatches, runCustomMenuItem} from '../extensions/org.devos.files/custom-menu.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    const temporary = GLib.dir_make_tmp('devos-files-settings-XXXXXX');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(760, 1150);
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replaceAll('@ACCENT@', '#88e0c0')));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(container).find(widget => widget.name === id) as T;
    try {
        root.render(<FilesSettings preferences={preferences} />); await wait();
        find<Gtk.Switch>('files-option-contextRename').set_active(false);
        find<Gtk.Switch>('files-option-contextTerminal').set_active(false);
        assert(!find('files-preview-contextRename') && preferences.get('org.devos.files').state.values.contextRename === true, 'Preview changes are isolated');
        find<Gtk.Button>('files-settings-apply').emit('clicked');
        const values = preferences.get('org.devos.files').state.values;
        assert(!values.contextRename && !values.contextTerminal && values.homeDirectory === '~', 'Apply saves context choices and preserves browser defaults');
        find<Gtk.Switch>('files-option-contextCopyPath').set_active(false); find<Gtk.Button>('files-settings-reset').emit('clicked');
        assert(find<Gtk.Switch>('files-option-contextCopyPath').active, 'Reset restores saved actions');
        find<Gtk.Entry>('files-custom-title').set_text('Open in my editor');
        find<Gtk.Entry>('files-custom-command').set_text('my-editor "{path}"');
        find<Gtk.ComboBoxText>('files-custom-target').set_active_id('file');
        find<Gtk.Button>('files-custom-save').emit('clicked');
        let custom = parseCustomMenu('[]');
        assert(parseCustomMenu(preferences.get('org.devos.files').state.values.contextCustomItems).length === 0, 'Adding a custom action stays a draft');
        find<Gtk.Button>('files-settings-apply').emit('clicked');
        custom = parseCustomMenu(preferences.get('org.devos.files').state.values.contextCustomItems);
        assert(custom.length === 1 && custom[0].target === 'file' && find(`files-preview-${custom[0].id}`), 'Custom action is saved and appears in preview');
        const customId = custom[0].id;
        find<Gtk.Button>(`files-custom-edit-${customId}`).emit('clicked');
        find<Gtk.Entry>('files-custom-title').set_text('My editor'); find<Gtk.Button>('files-custom-save').emit('clicked');
        find<Gtk.Button>('files-settings-apply').emit('clicked');
        assert(parseCustomMenu(preferences.get('org.devos.files').state.values.contextCustomItems)[0].title === 'My editor', 'Custom action can be edited');
        find<Gtk.Switch>(`files-custom-toggle-${customId}`).set_active(false);
        assert(!find(`files-preview-${customId}`), 'Custom action can be disabled');
        find<Gtk.Button>('files-settings-reset').emit('clicked');
        assert(find(`files-preview-${customId}`), 'Reset restores disabled custom actions');
        let called = '';
        const customMenu = createFileContextMenu(fileMenuOptions(preferences.get('org.devos.files').state.values), {}, true, false, false,
            {target: 'file', activate: item => {called = item.id;}});
        (customMenu.get_children()[0] as Gtk.MenuItem).activate(); customMenu.destroy();
        assert(called === customId && !customMenuMatches(custom[0], 'background'), 'Native custom action dispatch and target filtering');
        find<Gtk.Button>(`files-custom-delete-${customId}`).emit('clicked'); find<Gtk.Button>('files-settings-apply').emit('clicked');
        assert(!parseCustomMenu(preferences.get('org.devos.files').state.values.contextCustomItems).length, 'Remove deletes only the custom entry');
        assert(fileMenuItems.every(item => find(`files-option-${item.key}`)) && !widgets(container).some(widget => widget.name.startsWith('files-custom-delete-context')), 'All default actions remain with toggles and no remove controls');
        find<Gtk.Entry>('files-custom-title').set_text('Invalid'); find<Gtk.Entry>('files-custom-command').set_text('bad "quote');
        find<Gtk.Button>('files-custom-save').emit('clicked');
        assert(find('files-custom-error') && !widgets(container).some(widget => widget.name.startsWith('files-custom-delete-')), 'Invalid commands do not create entries');
        find<Gtk.Button>('files-custom-cancel').emit('clicked');
        let rejected = false;
        try {parseCustomMenu(JSON.stringify([{id: 'contextOpen', title: 'Override', command: 'true', enabled: true, target: 'any'}]));} catch {rejected = true;}
        assert(rejected, 'Custom IDs cannot replace a default action');
        const specialPath = `${temporary}/item ; $(ignored) 'quoted'.txt`;
        const arguments_ = customCommandArguments('tool "{path}" "{directory}"', specialPath, temporary);
        assert(arguments_[1] === specialPath && arguments_.length === 3, 'Paths with shell characters remain single literal arguments');
        let commandError = '';
        runCustomMenuItem({id: 'custom-test', title: 'Create test file', command: '/usr/bin/touch "{path}"', enabled: true, target: 'any'}, specialPath, temporary, error => {commandError = error;});
        for (let attempt = 0; attempt < 20 && !Gio.File.new_for_path(specialPath).query_exists(null); attempt++) await wait();
        assert(!commandError && Gio.File.new_for_path(specialPath).query_exists(null), 'Custom command runs with literal path substitution');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (screenshot) {
            window.show_all(); await wait(); window.get_pixbuf()!.savev(screenshot, 'png', [], []);
            const scroll = widgets(container).find(widget => widget instanceof Gtk.ScrolledWindow) as Gtk.ScrolledWindow;
            scroll.get_vadjustment().set_value(650); await wait(); window.get_pixbuf()!.savev(screenshot.replace('.png', '-custom.png'), 'png', [], []);
        }
        let activated = '';
        const actions = Object.fromEntries(fileMenuItems.map(item => [item.key, () => {activated = item.key;}])) as Record<FileMenuKey, () => void>;
        for (const selected of [true, false]) {
            const menu = createFileContextMenu(fileMenuOptions(values), actions, selected, false, true);
            const children = menu.get_children() as Gtk.MenuItem[];
            assert(!children.some(item => item.name === 'files-menu-contextRename' || item.name === 'files-menu-contextTerminal'), 'Hidden actions disappear from real native menu');
            assert(children.find(item => item.name === 'files-menu-contextOpen')!.sensitive === selected, 'Open requires a click target');
            const copy = children.find(item => item.name === 'files-menu-contextCopyPath')!; copy.activate();
            assert(activated === 'contextCopyPath', 'Native menu activates its action');
            assert((children.find(item => item.name === 'files-menu-contextHidden') as Gtk.CheckMenuItem).active, 'Native check item reflects hidden-file state');
            menu.destroy();
        }
        const disabled = createFileContextMenu(fileMenuOptions({contextEnabled: false}), actions, true, false, false);
        assert(!disabled.get_children().length, 'Master switch disables the native menu'); disabled.destroy();
        const busy = createFileContextMenu(fileMenuOptions(), actions, true, true, false);
        assert(!(busy.get_children().find(item => item.name === 'files-menu-contextRename')!).sensitive, 'Rename is disabled during operations'); busy.destroy();
    } finally {root.unmount(); window.destroy(); preferences.dispose(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css);}
    const directory = `${temporary}/files`; GLib.mkdir_with_parents(`${directory}/Child`, 0o700); GLib.file_set_contents(`${directory}/notes.txt`, 'test');
    const model = new FileBrowser(async () => {}), native = new Gtk.ApplicationWindow(), offscreen = new Gtk.OffscreenWindow(), host = new Gtk.Box();
    offscreen.set_size_request(1000, 650); offscreen.add(host);
    const view = mountFiles(native, model, {gridView: false, showHidden: false}, host);
    try {
        await model.navigate(directory); offscreen.show_all(); await wait();
        for (const grid of [false, true]) {
            view.setGrid(grid); await wait();
            const widget = widgets(host).find(item => item.name === (grid ? 'files-grid' : 'files-list')) as Gtk.ListBox | Gtk.FlowBox;
            const child = widget.get_children()[0], allocation = child.get_allocation();
            assert(fileContextEntry(widget, allocation.x + 5, allocation.y + 5, model.state.entries)?.path === `${directory}/Child`, 'Right-click coordinates target the correct item in list and grid');
            assert(!fileContextEntry(widget, 0, 100000, model.state.entries), 'Empty space has no stale file target');
        }
    } finally {view.destroy(); native.destroy(); offscreen.destroy(); model.dispose(); removeTree(temporary);}
    print('PASS: Files settings, custom CRUD, protected defaults, scope/command validation, literal path execution, native menu actions and list/grid click targets');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
