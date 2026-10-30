import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, Gio, GLib, createRoot, type SettingsValues} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {LauncherSettings} from '../src/apps/org.devos.launcher/settings-view.js';
import {launcherOptions} from '../src/apps/org.devos.launcher/options.js';
import {mountLauncher} from '../src/apps/org.devos.launcher/view.js';
import {launcherCustomization, workspaceAppKey} from '../src/apps/org.devos.launcher/customization.js';

Gtk.init(null);
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function widgets(widget: Gtk.Widget): Gtk.Widget[] { return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])]; }
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => { resolve(); return GLib.SOURCE_REMOVE; }));
async function verify() {
    assert(launcherOptions({}).menuWidth === 600 && launcherOptions({}).showDescriptions, 'Existing launcher defaults are preserved');
    assert(launcherCustomization({workspaceApps: 'bad'}).workspaceApps.length === 3 && launcherCustomization({workspaceApps: '[]'}).workspaceApps.length === 0, 'Invalid pins use defaults and an intentionally empty Workspace stays empty');
    assert(launcherOptions({menuWidth: 9999, iconSize: NaN}).menuWidth === 900 && launcherOptions({iconSize: NaN}).iconSize === 28, 'Invalid sizes are bounded or defaulted');
    const temporary = GLib.dir_make_tmp('devos-launcher-ui-XXXXXX');
    const preferences = new ExtensionManager({system: `${ROOT}/src/apps`, components: `${ROOT}/src/system`, bundled: `${ROOT}/src/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(760, 1100);
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const theme = new Gtk.CssProvider(); theme.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(container).find(widget => widget.name === id) as T;
    let applied = 0;
    try {
        root.render(<LauncherSettings preferences={preferences} applied={() => { applied++; }} />); await wait();
        preferences.update('org.devos.launcher', true, {...preferences.get('org.devos.launcher').state.values, appView: 'grid', workspaceApps: '[]'});
        find<Gtk.Button>('launcher-density-compact').emit('clicked');
        find<Gtk.SpinButton>('launcher-menu-width').set_value(720);
        find<Gtk.SpinButton>('launcher-icon-size').set_value(36);
        find<Gtk.Switch>('launcher-option-showWorkspace').set_active(false);
        assert(!find('launcher-preview-workspace') && find<Gtk.Label>('launcher-width-preview').get_text() === '720 px', 'Draft choices update the preview');
        assert(preferences.get('org.devos.launcher').state.values.menuWidth === 600, 'Preview does not persist before Apply');
        find<Gtk.Button>('launcher-settings-apply').emit('clicked');
        const saved = preferences.get('org.devos.launcher').state.values;
        assert(applied === 1 && saved.menuWidth === 720 && saved.iconSize === 36 && saved.compactRows && !saved.showWorkspace, 'Apply persists actual launcher options');
        assert(saved.appView === 'grid' && saved.workspaceApps === '[]', 'Applying layout preserves view and Workspace customization');
        find<Gtk.Switch>('launcher-option-rememberSearch').set_active(true);
        find<Gtk.Button>('launcher-settings-reset').emit('clicked');
        assert(!find<Gtk.Switch>('launcher-option-rememberSearch').active, 'Reset restores the saved settings');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (screenshot) { window.show_all(); await wait(); window.get_pixbuf()!.savev(screenshot, 'png', [], []); }
    } finally {
        root.unmount(); window.destroy(); preferences.dispose();
        for (const relative of ['preferences/org.devos.launcher.json', 'preferences', '']) { const file = Gio.File.new_for_path(`${temporary}/${relative}`); if (file.query_exists(null)) file.delete(null); }
    }
    const native = new Gtk.OffscreenWindow(); native.name = 'launcher'; native.set_size_request(900, 720);
    let stored: SettingsValues = {}, launches = 0;
    const app = Gio.AppInfo.create_from_commandline('/usr/bin/true', 'Pinned Alpha', Gio.AppInfoCreateFlags.NONE);
    const services = {display: Gdk.Display.get_default()!, installedApps: () => [app], searchApps: (items: Gio.AppInfo[]) => items,
        runCommand: () => {launches++; return true;}, quit() {}, openEditor() {}, getCustomization: () => stored,
        saveCustomization: (patch: SettingsValues) => {stored = {...stored, ...patch};}};
    let view = mountLauncher(native, services);
    const findNative = <T extends Gtk.Widget>(id: string) => widgets(native).find(widget => widget.name === id) as T;
    try {
        view.show(); await wait();
        findNative<Gtk.Button>('launcher-workspace-add').clicked();
        findNative<Gtk.Button>('launcher-pin-0').clicked();
        assert(launcherCustomization(stored).workspaceApps.includes(workspaceAppKey(app)) && native.visible && launches === 0, 'Pinning an app persists without launching or hiding Applications');
        findNative<Gtk.Button>('launcher-view-grid').clicked(); await wait();
        assert(stored.appView === 'grid' && findNative<Gtk.FlowBox>('launcher-app-grid').get_children().length === 1, 'Grid displays the app and saves the view');
        findNative<Gtk.Button>(`launcher-workspace-remove-${workspaceAppKey(app)}`).clicked();
        assert(!launcherCustomization(stored).workspaceApps.includes(workspaceAppKey(app)), 'Custom Workspace apps can be removed');
        findNative<Gtk.Button>('launcher-pin-0').clicked();
        for (const builtin of ['terminal', 'files', 'editor']) findNative<Gtk.Button>(`launcher-workspace-remove-builtin:${builtin}`).clicked();
        assert(launcherCustomization(stored).workspaceApps.length === 1 && !findNative('launcher-terminal'), 'Default Workspace shortcuts can also be removed');
        view.destroy(); view = mountLauncher(native, services); view.show(); await wait();
        assert(findNative('launcher-app-grid') && findNative(`launcher-workspace-${workspaceAppKey(app)}`), 'View and pinned app survive remount');
        findNative<Gtk.Button>('launcher-view-list').clicked(); await wait();
        assert(widgets(native).some(widget => widget instanceof Gtk.ListBox) && stored.appView === 'list', 'List view can be restored');
    } finally {view.destroy(); native.destroy();}
    const apps = ['Alpha', 'Beta'].map(name => Gio.AppInfo.create_from_commandline('/usr/bin/true', name, Gio.AppInfoCreateFlags.NONE));
    for (const rememberSearch of [false, true]) {
        const native = new Gtk.OffscreenWindow();
        let quit = 0;
        const view = mountLauncher(native, {display: Gdk.Display.get_default()!, installedApps: () => apps,
            searchApps: (items, query) => items.filter(app => app.get_display_name().toLowerCase().includes(query.toLowerCase())),
            runCommand: () => true, quit: () => { quit++; }, options: launcherOptions({rememberSearch, showDescriptions: false, showWorkspace: false, compactRows: true, iconSize: 24})});
        try {
            view.show();
            const children = () => widgets(native);
            assert(!children().some(widget => widget.name === 'launcher-terminal'), 'Workspace shortcuts can be hidden');
            assert(!children().some(widget => widget.get_style_context().has_class('launcher-app-description')), 'App descriptions can be hidden');
            const entry = children().find(widget => widget.name === 'launcher-search') as Gtk.SearchEntry;
            entry.set_text('Alpha'); view.hide(); view.show();
            assert(entry.get_text() === (rememberSearch ? 'Alpha' : ''), 'Search retention follows the setting');
            const rows = children().find(widget => widget instanceof Gtk.ListBox) as Gtk.ListBox;
            assert(rows.get_children().length === (rememberSearch ? 1 : 2), 'Real search results stay consistent');
            const row = rows.get_row_at_index(0)!.get_child() as Gtk.Box;
            assert(row.border_width === 4, 'Compact density applies to real app rows');
            view.requestLogout(); assert(quit === 0, 'Logout still requires confirmation');
            view.requestLogout(); assert(quit === 1, 'Confirmed logout still works');
        } finally { view.destroy(); native.destroy(); }
    }
    print('PASS: launcher preview, Apply/Reset, real search retention, compact rows, descriptions, shortcuts and logout confirmation');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => { failed = error; }).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
