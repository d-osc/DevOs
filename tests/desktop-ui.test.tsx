import Gtk from 'gi://Gtk?version=3.0';
import Gdk from 'gi://Gdk?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Cairo from 'cairo';
import {React, createRoot, DrawingArea, ListBox, ListBoxRow, Label} from '@dev-os/react-gtk';
import {mountLauncher} from '../src/launcher-view.js';
import {mountPanel} from '../src/panel-view.js';
import {Devices} from '../extensions/org.devos.panel/devices.js';
import {Panel} from '../extensions/org.devos.panel/index.js';
import type {UIContext} from '../src/extensions/runtime.js';
import {mountBackground} from '../src/background-view.js';
import {mountSettings} from '../src/settings-view.js';
import {SettingsPages} from '../src/extensions/settings-pages.js';
import {ExtensionManager} from '../src/extensions/manager.js';
import {DEFAULTS, ROOT, validateConfig} from '../src/config.js';
import icons, {installedIconThemes} from '../extensions/org.devos.icons/extension.js';
import {FileBrowser} from '../extensions/org.devos.files/model.js';
import {mountFiles} from '../extensions/org.devos.files/view.js';
import {Files} from '../extensions/org.devos.files/index.js';
import {TerminalWindow} from '../extensions/org.devos.terminal/extension.js';
import {Windows} from '../src/windows.js';
import {EditorDocument} from '../extensions/org.devos.editor/document.js';
import {EditorWindow} from '../extensions/org.devos.editor/extension.js';
import {EditorAssets} from '../extensions/org.devos.editor/assets.js';
import {FileSearch, DEFAULT_SEARCH_EXCLUDES, matchFiles} from '../extensions/org.devos.files/search.js';

Gtk.init(null);
let passed = 0;
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function test(name: string, callback: () => void): void { callback(); passed++; print(`PASS: React desktop ${name}`); }
function asyncTest(name: string, callback: () => Promise<void>): void {
    const loop = new GLib.MainLoop(null, false); let error: unknown, expired = false;
    const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => { expired = true; error = new Error('Async test timed out'); loop.quit(); return GLib.SOURCE_REMOVE; });
    void callback().then(() => loop.quit(), reason => { error = reason; loop.quit(); });
    loop.run(); if (!expired) GLib.source_remove(timeout); if (error) throw error;
    passed++; print(`PASS: React desktop ${name}`);
}
function removeFixture(file: Gio.File): void {
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
        const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        try { for (let child = children.next_file(null); child; child = children.next_file(null)) removeFixture(file.get_child(child.get_name())); }
        finally { children.close(null); }
    }
    file.delete(null);
}
const idle = () => new Promise<void>(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { resolve(); return GLib.SOURCE_REMOVE; }));
function widgets(parent: Gtk.Widget): Gtk.Widget[] {
    return [parent, ...(parent instanceof Gtk.Container ? parent.get_children().flatMap(widgets) : [])];
}
const application = new Gtk.Application({application_id: 'org.devos.UITest', flags: Gio.ApplicationFlags.NON_UNIQUE});
application.register(null);
const makeWindow = () => new Gtk.ApplicationWindow({application});
const display = Gdk.Display.get_default()!;
const apps = ['Alpha', 'Beta'].map(name => Gio.AppInfo.create_from_commandline('/usr/bin/true', name, Gio.AppInfoCreateFlags.NONE));
let quit = 0, commanded = '';
const window = makeWindow();
const launcher = mountLauncher(window, {
    display, installedApps: () => apps,
    searchApps: (items, query) => items.filter(app => app.get_display_name().toLowerCase().includes(query.toLowerCase())),
    quit: () => { quit++; }, runCommand: command => { commanded = command; return true; },
});
const entry = widgets(window).find(widget => widget instanceof Gtk.SearchEntry) as Gtk.SearchEntry;
const list = widgets(window).find(widget => widget instanceof Gtk.ListBox) as Gtk.ListBox;
const labels = () => widgets(window).filter(widget => widget instanceof Gtk.Label).map(widget => (widget as Gtk.Label).get_text());
const button = (text: string) => widgets(window).find(widget => widget instanceof Gtk.Button && widget.get_label() === text) as Gtk.Button;

test('search results, empty state and reopening reset', () => {
    launcher.show();
    assert(window.get_visible() && list.get_children().length === 2, 'Initial apps and visible launcher');
    entry.set_text('Beta');
    assert(list.get_children().length === 1 && labels().includes('Beta'), 'Search updates React list');
    entry.set_text('missing');
    assert(list.get_children().length === 0 && labels().some(text => text.startsWith('No applications')), 'Empty state');
    launcher.hide(); launcher.show();
    assert(entry.get_text() === '' && list.get_children().length === 2, 'Reopen restores app list');
});
test('logout confirmation is rendered and reset on hide', () => {
    launcher.requestLogout();
    assert(quit === 0 && !!button('Confirm log out'), 'First request must only confirm');
    assert(labels().some(text => text.startsWith('Save your work')), 'Confirmation message');
    launcher.hide(); launcher.show();
    assert(!!button('Log out'), 'Hide cancels confirmation');
    launcher.requestLogout(); launcher.requestLogout();
    assert(quit === 1, 'Second request quits');
});
test('system messages, native footer action and row activation', () => {
    launcher.showMessage('System message');
    assert(labels().includes('System message'), 'System message rendered through React');
    (widgets(window).find(widget => widget.name === 'launcher-terminal') as Gtk.Button).emit('clicked');
    assert(commanded === 'terminal' && !window.get_visible(), 'Footer action runs service and hides');
    launcher.show();
    list.emit('row-activated', list.get_row_at_index(0)!);
    assert(!window.get_visible(), 'Row activation launches selected app and hides');
    launcher.destroy(); window.destroy();
});
test('launcher workspace shortcuts, close action and complete app list', () => {
    const shortcutWindow = makeWindow(); let editorOpened = 0, settingsOpened = 0;
    const manyApps = Array.from({length: 65}, (_, index) =>
        Gio.AppInfo.create_from_commandline('/usr/bin/true', `Tool ${index}`, Gio.AppInfoCreateFlags.NONE));
    const view = mountLauncher(shortcutWindow, {
        display, installedApps: () => manyApps, searchApps: items => items,
        quit() {}, runCommand: () => true,
        openEditor: () => { editorOpened++; }, showSettings: () => { settingsOpened++; },
    });
    const click = (id: string) => (widgets(shortcutWindow).find(widget => widget.name === id) as Gtk.Button).emit('clicked');
    view.show();
    assert((widgets(shortcutWindow).find(widget => widget instanceof Gtk.ListBox) as Gtk.ListBox).get_children().length === 65,
        'All installed apps are reachable beyond the previous 60-app limit');
    click('launcher-editor');
    assert(editorOpened === 1 && !shortcutWindow.get_visible(), 'Editor shortcut opens the app and dismisses menu');
    view.show(); click('launcher-settings');
    assert(settingsOpened === 1 && !shortcutWindow.get_visible(), 'Settings shortcut opens preferences and dismisses menu');
    view.show(); click('launcher-close');
    assert(!shortcutWindow.get_visible(), 'Close button dismisses menu');
    view.destroy(); shortcutWindow.destroy();
});
test('panel message remains across React clock ticks', () => {
    const panelWindow = makeWindow();
    const panel = mountPanel(panelWindow, {
        config: {name: 'Test desktop', clock_format: '%H:%M:%S'},
        launcher: {toggle() {}}, runCommand: () => true,
    }, display.get_monitor(0)!);
    panel.showMessage('Keep this message'); panelWindow.show();
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1300, () => { loop.quit(); return GLib.SOURCE_REMOVE; });
    loop.run();
    assert(widgets(panelWindow).some(widget => widget instanceof Gtk.Button && widget.name === 'panel-alert' && widget.get_tooltip_text() === 'Keep this message'), 'Clock rerender preserves message');
    panel.root.unmount(); panelWindow.destroy();
});
asyncTest('compact panel allocates exactly 36 pixels with the application theme', async () => {
    const fixture = GLib.dir_make_tmp('dev-os-panel-size-XXXXXX');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${fixture}/packages`, preferences: `${fixture}/preferences`});
    const provider = new Gtk.CssProvider();
    provider.load_from_data(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replaceAll('@ACCENT@', DEFAULTS.accent));
    Gtk.StyleContext.add_provider_for_screen(display.get_default_screen(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const monitor = display.get_monitor(0)!;
    const context: UIContext = {application, display, preferences, config: () => ({...DEFAULTS, panel_height: 36}),
        saveCore() {}, monitors: () => [monitor], runCommand: () => true, reload: () => true, quit() {}, invoke() {},
        registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {}};
    const panel = new Panel(context, monitor);
    try {
        await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        assert(panel.window.get_allocated_height() === 36, `Expected 36 px panel, got ${panel.window.get_allocated_height()}`);
        const menu = widgets(panel.window).find(widget => widget.name === 'panel-menu')!;
        assert(menu.get_allocated_height() <= 34, `Compact menu is too tall: ${menu.get_allocated_height()}`);
        assert(menu.get_allocated_width() <= 38, `Compact menu is too wide: ${menu.get_allocated_width()}`);
    } finally { panel.destroy(); Gtk.StyleContext.remove_provider_for_screen(display.get_default_screen(), provider); removeFixture(Gio.File.new_for_path(fixture)); }
});
asyncTest('Wayland taskbar tracks minimize, restores exact windows and updates React indicators', async () => {
    const tracker = new Windows(), monitor = display.get_monitor(0)!;
    const panelWindow = makeWindow(); panelWindow.name = 'panel';
    let launched = 0;
    const panel = mountPanel(panelWindow, {config: DEFAULTS, launcher: {toggle() {}}, windows: tracker,
        runCommand: () => { launched++; return true; }}, monitor);
    const first = makeWindow(), second = makeWindow();
    let firstClosed = false, secondClosed = false;
    first.set_title('Dev OS Terminal · taskbar "first" ภาษาไทย'); second.set_title('Dev OS Terminal · taskbar second');
    const terminalButton = () => widgets(panelWindow).find(widget => widget.name === 'panel-terminal') as Gtk.Button;
    const waitFor = async (condition: () => boolean) => {
        for (let count = 0; count < 100; count++) {
            if (condition()) return;
            await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        }
        throw new Error('Wayland taskbar state did not arrive');
    };
    try {
        await idle(); terminalButton().emit('clicked'); assert(launched === 1, 'Empty pinned item launches app');
        first.show(); first.present();
        await waitFor(() => tracker.state.some(window => window.title === first.get_title() && window.active));
        const id = tracker.state.find(window => window.title === first.get_title())!.id;
        await waitFor(() => terminalButton().get_style_context().has_class('task-active'));
        first.iconify();
        await waitFor(() => tracker.state.find(window => window.id === id)?.minimized === true);
        await waitFor(() => terminalButton().get_style_context().has_class('task-minimized'));
        assert(terminalButton().get_style_context().has_class('task-running'), 'Minimized app remains running on panel');
        terminalButton().emit('clicked');
        await waitFor(() => tracker.state.some(window => window.id === id && window.active && !window.minimized));
        assert(launched === 1, 'Panel restores existing window instead of spawning duplicate');
        terminalButton().emit('clicked');
        await waitFor(() => tracker.state.find(window => window.id === id)?.minimized === true);
        second.show(); second.present();
        await waitFor(() => tracker.state.some(window => window.title === second.get_title() && window.active));
        const secondId = tracker.state.find(window => window.title === second.get_title())!.id;
        assert(secondId !== id, 'Separate handles for windows sharing one application ID');
        await waitFor(() => terminalButton().get_tooltip_text()?.includes('2 windows') === true);
        tracker.activate(id);
        await waitFor(() => tracker.state.some(window => window.id === id && window.active && !window.minimized));
        second.destroy(); secondClosed = true; await waitFor(() => !tracker.state.some(window => window.id === secondId));
        first.destroy(); firstClosed = true; await waitFor(() => !tracker.state.some(window => window.id === id));
        await waitFor(() => !terminalButton().get_style_context().has_class('task-running'));
    } finally { tracker.destroy(); panel.root.unmount(); panelWindow.destroy(); if (!firstClosed) first.destroy(); if (!secondClosed) second.destroy(); }
});
asyncTest('taskbar refreshes newly installed desktop apps and preserves themed and file icons', async () => {
    const identity = GLib.uuid_string_random();
    const appId = `org.devos.IconTest.${identity}`, alias = `icon-test-${identity}`;
    const directory = `${GLib.get_user_data_dir()}/applications`;
    GLib.mkdir_with_parents(directory, 0o700);
    const desktop = Gio.File.new_for_path(`${directory}/${appId}.desktop`);
    const fixture = GLib.dir_make_tmp('dev-os-panel-icon-XXXXXX');
    const iconFile = `${fixture}/app.svg`;
    GLib.file_set_contents(iconFile, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#ff5500"/></svg>');
    const panelWindow = makeWindow();
    const panel = mountPanel(panelWindow, {config: DEFAULTS, launcher: {toggle() {}}, runCommand: () => true,
        windows: {state: [{id: 71001, title: 'Icon fixture', appId: alias, active: false, minimized: false}],
            subscribe: () => () => {}, activate() {}, toggle() {}}}, display.get_monitor(0)!);
    const task = () => widgets(panelWindow).find(widget => widget.name === 'panel-task-71001') as Gtk.Button;
    const image = () => widgets(task()).find(widget => widget instanceof Gtk.Image) as Gtk.Image;
    const waitFor = async (condition: () => boolean) => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (condition()) return;
            await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        }
        throw new Error('Panel did not refresh desktop app icons');
    };
    const install = (icon: string) => GLib.file_set_contents(desktop.get_path()!,
        `[Desktop Entry]\nType=Application\nName=Live icon fixture\nExec=/usr/bin/true\nStartupWMClass=${alias}\nIcon=${icon}\n`);
    try {
        await idle();
        assert(image().get_icon_name()[0] === 'application-x-executable-symbolic', 'Unknown app uses fallback');
        install('utilities-terminal-symbolic');
        await waitFor(() => image().get_storage_type() === Gtk.ImageType.GICON);
        assert(image().get_gicon()[0]?.equal(Gio.ThemedIcon.new('utilities-terminal-symbolic')), 'App installed after mounting gets its real themed icon through WM class');
        assert(task().get_tooltip_text()?.startsWith('Live icon fixture'), 'App metadata also refreshes');
        install(iconFile);
        const expected = new Gio.FileIcon({file: Gio.File.new_for_path(iconFile)});
        await waitFor(() => image().get_storage_type() === Gtk.ImageType.GICON && image().get_gicon()[0]?.equal(expected) === true);
        assert(image().get_pixel_size() === 16, 'Full file icon keeps the compact panel size');
    } finally {
        panel.root.unmount(); panelWindow.destroy();
        if (desktop.query_exists(null)) desktop.delete(null);
        removeFixture(Gio.File.new_for_path(fixture));
    }
});
asyncTest('panel reads real command output and forwards audio controls', async () => {
    const fixture = GLib.dir_make_tmp('dev-os-audio-XXXXXX'), previousPath = GLib.getenv('PATH');
    const script = `${fixture}/wpctl`, commands = `${fixture}/commands`;
    GLib.file_set_contents(script, `#!/bin/sh
printf '%s\\n' "$*" >> '${commands}'
case "$1" in
get-volume) printf 'Volume: 0.42'; if [ -f '${fixture}/muted' ]; then printf ' [MUTED]'; fi; printf '\\n' ;;
set-mute) printf yes > '${fixture}/muted' ;;
esac
`);
    Gio.File.new_for_path(script).set_attribute_uint32('unix::mode', 0o755, Gio.FileQueryInfoFlags.NONE, null);
    GLib.setenv('PATH', fixture, true);
    const devices = new Devices();
    try {
        for (let index = 0; devices.state.volume === null && index < 100; index++) await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        assert(devices.state.volume === 42 && !devices.state.muted, 'Audio status comes from backend');
        await devices.toggleMute();
        assert(devices.state.muted, 'Mute state refreshes after action');
        await devices.setVolume(70);
        const sent = new TextDecoder().decode(GLib.file_get_contents(commands)[1]);
        assert(sent.includes('set-mute @DEFAULT_AUDIO_SINK@ toggle') && sent.includes('set-volume @DEFAULT_AUDIO_SINK@ 70%'), 'Controls reach the active backend');
    } finally { devices.destroy(); if (previousPath) GLib.setenv('PATH', previousPath, true); else GLib.unsetenv('PATH'); removeFixture(Gio.File.new_for_path(fixture)); }
});
test('native list keyed reorder keeps row identity', () => {
    const host = new Gtk.Box(), root = createRoot(host);
    const row = React.createRef<Gtk.ListBoxRow>();
    const tree = (keys: string[]) => <ListBox>{keys.map(key => <ListBoxRow key={key} ref={key === 'b' ? row : undefined}>
        <Label>{key}</Label></ListBoxRow>)}</ListBox>;
    root.render(tree(['a', 'b', 'c']));
    const original = row.current;
    root.render(tree(['c', 'b', 'a']));
    const nativeList = host.get_children()[0] as Gtk.ListBox;
    assert(nativeList.get_children().map(child => ((child as Gtk.ListBoxRow).get_child() as Gtk.Label).get_text()).join('') === 'cba', 'GTK row order');
    assert(row.current === original, 'Keyed row reused');
    root.unmount(); host.destroy();
});
test('background canvas and updated draw handler', () => {
    const backgroundWindow = makeWindow();
    const background = mountBackground(backgroundWindow, {name: 'Test', accent: '#88e0c0', background: '#101b25'});
    const canvas = backgroundWindow.get_child() as Gtk.DrawingArea;
    assert(canvas instanceof Gtk.DrawingArea, 'Wallpaper canvas mounted by React');
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 640, 480);
    const context = new Cairo.Context(surface);
    canvas.emit('draw', context);
    background.unmount(); backgroundWindow.destroy();
    const host = new Gtk.Box(), root = createRoot(host);
    let drawn = '';
    root.render(<DrawingArea onDraw={() => { drawn = 'old'; return false; }} />);
    root.render(<DrawingArea onDraw={() => { drawn = 'new'; return false; }} />);
    host.get_children()[0].emit('draw', context);
    assert(drawn === 'new', 'Draw signal uses latest React props');
    root.unmount(); host.destroy();
});
test('settings validates core drafts and generates extension forms', () => {
    const temporary = GLib.dir_make_tmp('dev-os-ui-settings-XXXXXX');
    const extensions = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    let core = validateConfig(DEFAULTS), applied = 0;
    const settingsWindow = makeWindow();
    const settings = mountSettings(settingsWindow, {extensions, getCore: () => core,
        saveCore: value => { core = validateConfig(value); }, applied: () => { applied++; }});
    const children = () => widgets(settingsWindow);
    const click = (label: string) => (children().find(widget => widget instanceof Gtk.Button && widget.get_label() === label) as Gtk.Button).emit('clicked');
    const field = (key: string) => children().find(widget => widget.name === `settings-field-${key}`) as Gtk.Entry;
    const navigate = (id: string) => (children().find(widget => widget.name === `settings-nav-${id}`) as Gtk.Button).emit('clicked');
    const entries = () => children().filter(widget => widget instanceof Gtk.Entry && !(widget instanceof Gtk.SearchEntry)) as Gtk.Entry[];
    field('panel_height').set_text('999'); click('Apply');
    assert(applied === 0 && core.panel_height === DEFAULTS.panel_height, 'Invalid core draft must not apply');
    field('panel_height').set_text('64'); click('Apply');
    assert(applied === 1 && core.panel_height === 64, 'Valid core applies');
    field('panel_height').set_text('72'); click('Reset');
    assert(field('panel_height').get_text() === '64' && applied === 1, 'Reset restores saved values without applying');
    const search = children().find(widget => widget.name === 'settings-search') as Gtk.SearchEntry;
    search.set_text('minimap');
    assert(children().some(widget => widget.name === 'settings-nav-org.devos.editor') &&
        !children().some(widget => widget.name === 'settings-nav-org.devos.clock'), 'Search finds extensions by their setting names');
    search.set_text(''); navigate('org.devos.clock');
    assert(entries().length === 1, 'Manifest string generates native entry');
    (children().find(widget => widget.name === 'settings-enable-extension') as Gtk.Switch).set_active(true);
    (children().find(widget => widget.name === 'settings-field-showSeconds') as Gtk.Switch).set_active(true);
    field('format').set_text('%H:%M'); click('Apply');
    const saved = extensions.get('org.devos.clock')!;
    assert(saved.state.enabled && saved.state.values.showSeconds === true && saved.state.values.format === '%H:%M', 'Generated form saves typed extension values');
    entries()[0].set_text('Unsaved'); settings.show(); navigate('org.devos.clock');
    assert(entries()[0].get_text() === '%H:%M', 'Reopening discards unapplied draft');
    navigate('org.devos.panel');
    assert(!children().some(widget => widget.name === 'settings-enable-extension'), 'Base UI has no disable toggle');
    entries()[0].set_text('20'); click('Apply');
    assert(extensions.get('org.devos.panel').state.values.spacing === 20, 'System package JSON generates editable preferences');
    navigate('org.devos.icons');
    entries()[0].set_text('HighContrast'); click('Apply');
    assert(extensions.get('org.devos.icons').state.values.themeName === 'HighContrast', 'Icon theme form persists its JSON settings');
    navigate('org.devos.background');
    assert(children().some(widget => widget instanceof Gtk.Label && widget.get_text() === 'This extension has no configurable options.'), 'Base extension without settings has an explicit empty state');
    settings.destroy(); settingsWindow.destroy(); extensions.dispose();
    Gio.File.new_for_path(`${temporary}/preferences/org.devos.clock.json`).delete(null);
    Gio.File.new_for_path(`${temporary}/preferences/org.devos.panel.json`).delete(null);
    Gio.File.new_for_path(`${temporary}/preferences/org.devos.icons.json`).delete(null);
    Gio.File.new_for_path(`${temporary}/preferences`).delete(null);
    Gio.File.new_for_path(temporary).delete(null);
});
test('extension settings pages render and fall back after contribution cleanup', () => {
    const temporary = GLib.dir_make_tmp('dev-os-settings-pages-XXXXXX');
    const extensions = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const pages = new SettingsPages();
    const remove = pages.register('org.devos.updates', () => <Label>Custom update controls</Label>);
    const settingsWindow = makeWindow();
    const settings = mountSettings(settingsWindow, {extensions, pages, getCore: () => DEFAULTS, saveCore() {}, applied() {}});
    (widgets(settingsWindow).find(widget => widget.name === 'settings-nav-org.devos.updates') as Gtk.Button).emit('clicked');
    assert(widgets(settingsWindow).some(widget => widget instanceof Gtk.Label && widget.get_text() === 'Custom update controls'), 'Extension owns its settings page');
    remove(); settings.show();
    (widgets(settingsWindow).find(widget => widget.name === 'settings-nav-org.devos.updates') as Gtk.Button).emit('clicked');
    assert(widgets(settingsWindow).some(widget => widget.name === 'settings-field-repository'), 'Unregistered page falls back to JSON preferences');
    settings.destroy(); settingsWindow.destroy(); extensions.dispose(); removeFixture(Gio.File.new_for_path(temporary));
});
test('icon theme changes live, falls back and restores settings on cleanup', () => {
    const temporary = GLib.dir_make_tmp('dev-os-icons-test-XXXXXX');
    const extensions = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const settings = Gtk.Settings.get_for_screen(display.get_default_screen());
    const theme = Gtk.IconTheme.get_for_screen(display.get_default_screen());
    const original = settings.gtk_icon_theme_name;
    const paths = theme.get_search_path() ?? [];
    const testTheme = 'DevOSTestIcons';
    GLib.mkdir_with_parents(`${temporary}/icons/${testTheme}/16x16/actions`, 0o700);
    GLib.file_set_contents(`${temporary}/icons/${testTheme}/index.theme`, '[Icon Theme]\nName=Dev OS test\nComment=Test fixture\nInherits=Adwaita\nDirectories=16x16/actions\n\n[16x16/actions]\nSize=16\nContext=Actions\nType=Fixed\n');
    theme.set_search_path([...paths, `${temporary}/icons`]);
    assert(installedIconThemes(theme).includes('Adwaita'), 'Default theme is installed');
    const cleanup = icons.activate({display, preferences: extensions, onReload: () => () => {}});
    assert(settings.gtk_icon_theme_name === 'Adwaita', 'Manifest default applies at activation');
    extensions.update('org.devos.icons', true, {themeName: testTheme, useSystemTheme: false});
    assert(settings.gtk_icon_theme_name === testTheme, 'Preferences notification changes GTK theme');
    assert(theme.lookup_icon('folder-symbolic', 24, Gtk.IconLookupFlags.FORCE_SYMBOLIC) !== null, 'Symbolic shell icons still resolve');
    extensions.update('org.devos.icons', true, {themeName: 'dev-os-missing-theme', useSystemTheme: false});
    assert(settings.gtk_icon_theme_name === original, 'Missing theme falls back');
    extensions.update('org.devos.icons', true, {themeName: testTheme, useSystemTheme: true});
    assert(settings.gtk_icon_theme_name === original, 'Session theme option restores original');
    cleanup();
    extensions.update('org.devos.icons', true, {themeName: testTheme, useSystemTheme: false});
    assert(settings.gtk_icon_theme_name === original, 'Cleanup removes subscription and restores theme');
    extensions.dispose();
    theme.set_search_path(paths);
    for (const path of ['16x16/actions', '16x16', 'index.theme', '']) Gio.File.new_for_path(`${temporary}/icons/${testTheme}/${path}`).delete(null);
    Gio.File.new_for_path(`${temporary}/icons`).delete(null);
    Gio.File.new_for_path(`${temporary}/preferences/org.devos.icons.json`).delete(null);
    Gio.File.new_for_path(`${temporary}/preferences`).delete(null);
    Gio.File.new_for_path(temporary).delete(null);
});
asyncTest('file browser async navigation, history, safe mutations and cancellation', async () => {
    const temporary = GLib.dir_make_tmp('dev-os-file-model-XXXXXX');
    GLib.mkdir_with_parents(`${temporary}/Child`, 0o700);
    GLib.file_set_contents(`${temporary}/note2.txt`, 'original'); GLib.file_set_contents(`${temporary}/note10.txt`, 'ten');
    GLib.file_set_contents(`${temporary}/.secret`, 'hidden');
    let opened = ''; const model = new FileBrowser(async uri => { opened = uri; });
    try {
        assert(await model.navigate(temporary), 'Read folder');
        assert(model.state.entries.map(entry => entry.name).join(',') === 'Child,.secret,note2.txt,note10.txt', 'Folders first and natural ordering');
        assert(model.state.entries.find(entry => entry.name === '.secret')!.hidden, 'Hidden metadata');
        assert(model.state.entries.every(entry => entry.modified > 0), 'Real modification timestamps');
        await model.navigate(`${temporary}/Child`); await model.back(); assert(model.state.directory === temporary, 'Back history');
        await model.forward(); assert(model.state.directory === `${temporary}/Child`, 'Forward history');
        assert(!await model.navigate(`${temporary}/missing`) && model.state.directory === `${temporary}/Child`, 'Failed navigation preserves directory');
        await model.up();
        assert(await model.createFolder('New folder'), 'Create folder');
        assert(await model.rename('Renamed folder'), 'Rename selected folder');
        assert(!await model.rename('note2.txt'), 'Collision must not overwrite existing file');
        assert(!await model.createFolder('../escape'), 'Reject path traversal');
        assert(!await model.createFolder('note2.txt'), 'Reject existing name');
        assert(new TextDecoder().decode(GLib.file_get_contents(`${temporary}/note2.txt`)[1]) === 'original', 'Existing content preserved');
        const entry = model.state.entries.find(item => item.name === 'note10.txt')!;
        await model.open(entry); assert(opened === Gio.File.new_for_path(entry.path).get_uri(), 'Open file through injected default-app service');
        const pending = model.navigate(temporary), latest = model.navigate(`${temporary}/Child`);
        await Promise.all([pending, latest]); assert(model.state.directory === `${temporary}/Child`, 'Stale read cannot replace latest navigation');
        const cancelled = model.navigate(temporary); model.dispose(); assert(!await cancelled, 'Dispose cancels pending read');
    } finally { model.dispose(); removeFixture(Gio.File.new_for_path(temporary)); }
});
asyncTest('React file grid, list, hidden files, folder creation, rename and activation', async () => {
    const temporary = GLib.dir_make_tmp('dev-os-file-ui-XXXXXX');
    GLib.mkdir_with_parents(`${temporary}/Child`, 0o700);
    GLib.file_set_contents(`${temporary}/notes.txt`, 'hello'); GLib.file_set_contents(`${temporary}/.secret`, 'hidden');
    const model = new FileBrowser(async () => {}), filesWindow = makeWindow();
    const view = mountFiles(filesWindow, model, {gridView: true, showHidden: false});
    const children = () => widgets(filesWindow);
    const click = (label: string) => (children().find(widget => widget instanceof Gtk.Button && widget.get_label() === label) as Gtk.Button).emit('clicked');
    const waitFor = async (condition: () => boolean) => { for (let count = 0; count < 500; count++) { await idle(); if (condition()) return; } throw new Error('UI condition not reached'); };
    try {
        await model.navigate(temporary); await idle();
        click('Copy path');
        assert(Gtk.Clipboard.get_for_display(display, Gdk.Atom.intern('CLIPBOARD', false)).wait_for_text() === temporary, 'Copy current folder path');
        let grid = children().find(widget => widget instanceof Gtk.FlowBox) as Gtk.FlowBox;
        assert(grid.get_children().length === 2, 'Grid filters hidden files');
        (children().find(widget => widget instanceof Gtk.CheckButton) as Gtk.CheckButton).set_active(true);
        assert(grid.get_children().length === 3, 'Hidden file toggle updates native grid');
        (children().find(widget => widget instanceof Gtk.CheckButton) as Gtk.CheckButton).set_active(false);
        click('List view');
        let list = children().find(widget => widget instanceof Gtk.ListBox) as Gtk.ListBox;
        assert(list.get_children().length === 2, 'Native list view');
        click('New folder');
        (children().find(widget => widget.name === 'files-name') as Gtk.Entry).set_text('Created'); click('Create');
        await waitFor(() => !model.state.busy && model.state.entries.some(entry => entry.name === 'Created'));
        list = children().find(widget => widget instanceof Gtk.ListBox) as Gtk.ListBox;
        list.select_row(list.get_row_at_index(model.state.entries.filter(entry => !entry.hidden).findIndex(entry => entry.name === 'Created')));
        click('Copy path');
        assert(Gtk.Clipboard.get_for_display(display, Gdk.Atom.intern('CLIPBOARD', false)).wait_for_text() === `${temporary}/Created`, 'Copy selected item path');
        click('Rename'); (children().find(widget => widget.name === 'files-name') as Gtk.Entry).set_text('Changed'); click('Save name');
        await waitFor(() => !model.state.busy && model.state.entries.some(entry => entry.name === 'Changed'));
        list = children().find(widget => widget instanceof Gtk.ListBox) as Gtk.ListBox;
        list.emit('row-activated', list.get_row_at_index(0)!);
        await waitFor(() => model.state.directory.endsWith('/Changed') && !model.state.loading);
        assert(children().some(widget => widget instanceof Gtk.Label && widget.get_text() === 'This folder is empty'), 'Folder activation navigates');
        await model.back(); await idle(); click('Grid view');
        grid = children().find(widget => widget instanceof Gtk.FlowBox) as Gtk.FlowBox;
        grid.emit('child-activated', grid.get_child_at_index(1)!);
        await waitFor(() => model.state.directory.endsWith('/Child') && !model.state.loading);
        assert(model.state.directory.endsWith('/Child'), 'Grid double-click activation navigates');
        const address = children().find(widget => widget.name === 'files-location') as Gtk.Entry;
        address.set_text(temporary); address.emit('activate');
        await waitFor(() => model.state.directory === temporary && !model.state.loading);
    } finally { model.dispose(); view.destroy(); filesWindow.destroy(); removeFixture(Gio.File.new_for_path(temporary)); }
});
asyncTest('Files tabs preserve independent folders and history, close safely and constrain header width', async () => {
    const fixture = GLib.dir_make_tmp('dev-os-file-tabs-XXXXXX');
    GLib.mkdir_with_parents(`${fixture}/A/Child`, 0o700); GLib.mkdir_with_parents(`${fixture}/B`, 0o700);
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${fixture}/packages`, preferences: `${fixture}/preferences`});
    preferences.update('org.devos.files', true, {homeDirectory: `${fixture}/A`});
    const context: UIContext = {application, display, preferences, config: () => DEFAULTS,
        saveCore() {}, monitors: () => [display.get_monitor(0)!], runCommand: () => true, reload: () => true, quit() {}, invoke() {},
        registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {}};
    let closed = 0;
    const files = new Files(context, () => { closed++; files.destroy(); });
    const ready = async (model: FileBrowser, directory: string) => {
        for (let count = 0; count < 500; count++) { await idle(); if (!model.state.loading && model.state.directory === directory) return; }
        throw new Error(`Tab did not navigate to ${directory}`);
    };
    const tabButton = (id: string) => widgets(files.window.get_titlebar()!).find(widget => widget.name === id) as Gtk.Button;
    try {
        const first = files.model; await ready(first, `${fixture}/A`);
        await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        const initialWidth = files.window.get_allocated_width();
        await first.navigate(`${fixture}/A/Child`);
        const secondId = files.addTab(`${fixture}/B`)!, second = files.model;
        await ready(second, `${fixture}/B`);
        assert(first !== second, 'Tabs have independent filesystem models');
        tabButton('window-tab-1').emit('clicked');
        assert(files.model === first && first.state.directory === `${fixture}/A/Child`, 'Clicking a tab restores its folder');
        await first.back();
        assert(first.state.directory === `${fixture}/A` && second.state.directory === `${fixture}/B`, 'History stays local to each tab');
        files.closeTab(secondId);
        assert(files.model === first, 'Closing inactive tab keeps active model');
        tabButton('window-tab-add').emit('clicked');
        const added = files.model; await ready(added, `${fixture}/A`);
        assert(added !== first, 'Plus opens a new tab in current folder');
        files.cycleTab(-1); assert(files.model === first, 'Backward keyboard cycling');
        files.cycleTab(1); assert(files.model === added, 'Forward keyboard cycling');
        tabButton('window-tab-close-3').emit('clicked');
        assert(files.model === first && closed === 0, 'Closing active tab selects neighbor');
        const extras = Array.from({length: 8}, () => files.addTab(`${fixture}/B`)!);
        await ready(files.model, `${fixture}/B`);
        await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        assert(files.window.get_allocated_width() <= initialWidth, `Many tabs must scroll instead of widening window: ${files.window.get_allocated_width()} > ${initialWidth}`);
        const scroller = widgets(files.window.get_titlebar()!).find(widget => widget.name === 'window-tab-scroll') as Gtk.ScrolledWindow;
        assert(scroller.get_hadjustment().get_value() > 0, 'Active overflow tab is scrolled into view');
        files.selectTab(1);
        await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        assert(scroller.get_hadjustment().get_value() === 0, 'Selecting first tab scrolls back to the start');
        for (const id of extras) files.closeTab(id);
        files.closeTab(1); assert(closed === 1, 'Closing last tab closes window once');
    } finally { files.destroy(); removeFixture(Gio.File.new_for_path(fixture)); }
});
asyncTest('Files detach and merge retain the live model, history and view state', async () => {
    const fixture = GLib.dir_make_tmp('dev-os-file-transfer-XXXXXX');
    GLib.mkdir_with_parents(`${fixture}/folder`, 0o700);
    GLib.file_set_contents(`${fixture}/folder/selected.txt`, 'selection');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${fixture}/packages`, preferences: `${fixture}/preferences`});
    preferences.update('org.devos.files', true, {homeDirectory: fixture});
    const context: UIContext = {application, display, preferences, config: () => DEFAULTS,
        saveCore() {}, monitors: () => [display.get_monitor(0)!], runCommand: () => true, reload: () => true, quit() {}, invoke() {},
        registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {}};
    const opened = new Set<Files>(), closed: Files[] = [];
    const files = new Files(context, window => { opened.delete(window); closed.push(window); }, {opened: window => opened.add(window)});
    try {
        const firstId = files.activeTabId, first = files.model;
        await first.navigate(fixture); await first.navigate(`${fixture}/folder`);
        first.select(`${fixture}/folder/selected.txt`);
        files.addTab(fixture); const second = files.model;
        files.detachTab(firstId);
        const detached = [...opened].find(window => window !== files)!;
        assert(detached.model === first, 'Detach moves the exact model without rebuilding it');
        assert(first.state.selected === `${fixture}/folder/selected.txt`, 'Selection survives detach');
        assert(files.model === second && opened.size === 2, 'Source keeps the remaining tab');
        await first.back(); assert(first.state.directory === fixture, 'Original navigation history survives');
        detached.moveTab(detached.activeTabId, files, files.activeTabId);
        assert(files.model === first && opened.size === 1 && closed.includes(detached), 'Merge closes the empty source and selects the transferred tab');
        const mergedId = files.activeTabId;
        files.cycleTab(1); assert(files.model === second, 'Drop inserts before the target tab');
        const survivorId = files.activeTabId;
        files.moveTab(survivorId, files, mergedId); files.cycleTab(1);
        assert(files.model === first, 'Moving within the strip reorders tabs');
        // A delayed model notification must update its current owner.
        await first.navigate(`${fixture}/folder`);
        assert(files.window.get_title()?.endsWith('/folder'), 'Transferred model updates the destination title');
        files.detachTab(files.activeTabId);
        const final = [...opened].find(window => window !== files)!;
        files.moveTab(files.activeTabId, final);
        assert(opened.size === 1 && closed.includes(files), 'Merging the last source tab closes its window');
    } finally { for (const file of [...opened]) file.destroy(); removeFixture(Gio.File.new_for_path(fixture)); }
});
asyncTest('Terminal detach and merge retain the PTY, shell state and exit ownership', async () => {
    const fixture = GLib.dir_make_tmp('dev-os-terminal-transfer-XXXXXX');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${fixture}/packages`, preferences: `${fixture}/preferences`});
    const context: UIContext = {application, display, preferences, config: () => DEFAULTS,
        saveCore() {}, monitors: () => [display.get_monitor(0)!], runCommand: () => true, reload: () => true, quit() {}, invoke() {},
        registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {}};
    const opened = new Set<TerminalWindow>(), closed: TerminalWindow[] = [];
    const terminal = new TerminalWindow(context, fixture, window => { opened.delete(window); closed.push(window); }, {opened: window => opened.add(window)});
    const waitFor = async (predicate: () => boolean) => {
        for (let i = 0; i < 150; i++) {
            if (predicate()) return;
            await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        }
        throw new Error('Transferred terminal did not become ready');
    };
    try {
        // Detach while the VTE import/spawn is still pending.
        terminal.detachTab(terminal.activeTabId);
        const detached = [...opened][0];
        assert(closed.includes(terminal) && opened.size === 1, 'Last tab detaches into a new window');
        await waitFor(() => !!detached.terminal?.get_pty());
        const surface = detached.terminal!, pty = surface.get_pty();
        surface.feed_child(`export DEV_OS_TRANSFER_TOKEN=preserved; printf '%s' "$DEV_OS_TRANSFER_TOKEN" > '${fixture}/before'\n`);
        await waitFor(() => Gio.File.new_for_path(`${fixture}/before`).query_exists(null));
        detached.addTab(fixture);
        const otherId = detached.activeTabId;
        detached.cycleTab(-1);
        const firstId = detached.activeTabId;
        detached.detachTab(firstId);
        const transferred = [...opened].find(window => window !== detached)!;
        assert(transferred.terminal === surface && surface.get_pty() === pty, 'Live VTE widget and PTY move without restarting');
        transferred.moveTab(transferred.activeTabId, detached, otherId);
        assert(opened.size === 1 && detached.terminal === surface, 'Merge retains the shell and closes the empty window');
        surface.feed_child(`printf '%s' "$DEV_OS_TRANSFER_TOKEN" > '${fixture}/after'\n`);
        await waitFor(() => Gio.File.new_for_path(`${fixture}/after`).query_exists(null));
        assert(new TextDecoder().decode(GLib.file_get_contents(`${fixture}/after`)[1]) === 'preserved', 'Shell environment survives both detach and merge');
        surface.feed_child('exit\n');
        await waitFor(() => detached.activeTabId === otherId);
        assert(opened.size === 1 && !closed.includes(detached), 'Shell exit closes only its tab in the current owner');
    } finally { for (const window of [...opened]) window.destroy(); removeFixture(Gio.File.new_for_path(fixture)); }
});
asyncTest('recursive Quick Open ranking, exclusions, bounds and cancelled searches', async () => {
    const temporary = GLib.dir_make_tmp('dev-os-search-model-XXXXXX');
    const other = GLib.dir_make_tmp('dev-os-search-other-XXXXXX');
    GLib.mkdir_with_parents(`${temporary}/src/nested`, 0o700);
    GLib.mkdir_with_parents(`${temporary}/node_modules/package`, 0o700);
    GLib.mkdir_with_parents(`${temporary}/.git`, 0o700);
    for (const name of ['src/nested/files-view.tsx', 'src/view.tsx', 'view.tsx', '.env', 'node_modules/package/view.tsx', '.git/config'])
        GLib.file_set_contents(`${temporary}/${name}`, 'fixture');
    GLib.file_set_contents(`${other}/other.ts`, 'other');
    Gio.File.new_for_path(`${temporary}/src/nested/loop`).make_symbolic_link(temporary, null);
    const search = new FileSearch(), options = {excludedDirectories: DEFAULT_SEARCH_EXCLUDES.split(',')};
    try {
        await search.start(temporary, options);
        assert(!search.state.scanning && !search.state.error && search.state.indexed === 5, 'Nested files and dotfiles indexed; exclusions and symlink loop not traversed');
        const files = search.state.results;
        assert(matchFiles(files, 'view.tsx').results[0].relative === 'view.tsx', 'Exact file name prefers shorter path');
        assert(matchFiles(files, 'FVTSX').results[0].relative === 'src/nested/files-view.tsx', 'Case-insensitive fuzzy file name');
        assert(matchFiles(files, 'src/nested').results[0].relative.startsWith('src/nested/'), 'Relative path search');
        assert(matchFiles(files, 'files tsx').results[0].name === 'files-view.tsx', 'Multiple search terms');
        assert(matchFiles(files, 'does-not-exist').matches === 0, 'No results');
        search.setQuery('wrong'); search.setQuery('fvtsx');
        const loop = new GLib.MainLoop(null, false);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => { loop.quit(); return GLib.SOURCE_REMOVE; }); loop.run();
        assert(!search.state.pending && search.state.query === 'fvtsx' && search.state.matches === 1, 'Debounce uses the latest query');
        await search.start(temporary, {...options, maxEntries: 2});
        assert(search.state.limited && !search.state.scanning, 'Bounded indexing reports partial results');
        const previous = search.start(temporary, options), latest = search.start(other, options);
        await Promise.all([previous, latest]);
        assert(search.state.root === other && search.state.results.length === 1 && search.state.results[0].name === 'other.ts', 'Cancelled scan cannot contaminate the new workspace');
        await search.start(`${other}/missing`, options);
        assert(!!search.state.error && !search.state.scanning, 'Unreadable root reports an error');
        let notified = 0; search.subscribe(() => { notified++; });
        const pending = search.start(temporary, options); search.dispose(); const disposedCount = notified;
        await pending; assert(notified === disposedCount, 'Disposal cancels IO and further notifications');
    } finally { search.dispose(); removeFixture(Gio.File.new_for_path(temporary)); removeFixture(Gio.File.new_for_path(other)); }
});
asyncTest('React Quick Open keyboard selection, file opening, reveal and escape', async () => {
    const temporary = GLib.dir_make_tmp('dev-os-search-ui-XXXXXX');
    GLib.mkdir_with_parents(`${temporary}/src`, 0o700);
    GLib.file_set_contents(`${temporary}/src/alpha.ts`, 'alpha'); GLib.file_set_contents(`${temporary}/src/beta.ts`, 'beta');
    let opened = '';
    const model = new FileBrowser(async uri => { opened = uri; }), window = makeWindow();
    const view = mountFiles(window, model, {gridView: false, showHidden: false});
    const children = () => widgets(window);
    const quickEntry = () => children().find(widget => widget.name === 'files-quick-search') as Gtk.SearchEntry;
    const waitFor = async (condition: () => boolean) => {
        const deadline = GLib.get_monotonic_time() + 3000000;
        while (GLib.get_monotonic_time() < deadline) { await idle(); if (condition()) return; }
        throw new Error('Quick Open UI condition not reached');
    };
    try {
        await model.navigate(temporary); view.quickOpen();
        await waitFor(() => children().some(widget => widget instanceof Gtk.Label && widget.get_text().startsWith('2 files indexed')));
        assert(!!quickEntry(), 'Quick Open renders its own search entry');
        assert(view.searchKey(Gdk.KEY_Down), 'Quick Open handles Down');
        const resultList = children().find(widget => widget.name === 'files-quick-results') as Gtk.ListBox;
        assert(resultList.get_selected_row()?.get_index() === 1, `Down selects the second match (got ${resultList.get_selected_row()?.get_index()})`);
        view.searchKey(Gdk.KEY_Return);
        assert(opened.endsWith('/src/beta.ts'), `Enter opens beta.ts (got ${opened})`);
        await waitFor(() => opened.endsWith('/src/beta.ts'));
        assert(!quickEntry() && model.state.directory === temporary, 'Enter opens the selected file through default-app service');
        view.quickOpen(); quickEntry().set_text('alp');
        await waitFor(() => children().some(widget => widget instanceof Gtk.Label && widget.get_text() === '1 / 1 matches'));
        view.searchKey(Gdk.KEY_Return, true);
        await waitFor(() => model.state.directory === `${temporary}/src` && model.state.selected === `${temporary}/src/alpha.ts`);
        assert(!quickEntry(), 'Shift Enter reveals and selects the nested file');
        view.quickOpen(); assert(view.searchKey(Gdk.KEY_Escape) && !quickEntry(), 'Escape closes search and restores the browser');
    } finally { model.dispose(); view.destroy(); window.destroy(); removeFixture(Gio.File.new_for_path(temporary)); }
});
asyncTest('Editor UTF-8 file IO keeps unsaved edits and detects external modifications', async () => {
    const fixture = GLib.dir_make_tmp('dev-os-editor-model-XXXXXX');
    const path = `${fixture}/hello.ts`, other = `${fixture}/saved.ts`, model = new EditorDocument();
    GLib.file_set_contents(path, '\ufeffconst message = "สวัสดี";\r\n');
    try {
        assert(await model.load(path), `Open UTF-8 file: ${model.error}`);
        assert(model.language === 'typescript' && !model.dirty, 'File extension selects TypeScript');
        model.edit('const answer = 42;\r\n'); assert(model.dirty, 'Edits are unsaved');
        assert(await model.save(), `Save: ${model.error}`);
        const [, bytes] = GLib.file_get_contents(path);
        assert(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, 'UTF-8 BOM preserved');
        assert(new TextDecoder().decode(bytes.subarray(3)) === 'const answer = 42;\r\n' && !model.dirty, 'CRLF preserved and dirty state cleared');
        model.edit('local edit');
        GLib.file_set_contents(path, 'external edit with a different size');
        assert(!await model.save() && model.dirty && !!model.error, 'External modifications cannot be silently overwritten');
        assert(await model.save(other) && model.path === other, 'Save As keeps the original external file');
        GLib.file_set_contents(`${fixture}/binary`, new Uint8Array([0, 255, 128]));
        assert(!await model.load(`${fixture}/binary`) && model.path === other, 'Rejected binary input preserves the current document');
    } finally { model.dispose(); removeFixture(Gio.File.new_for_path(fixture)); }
});
asyncTest('Monaco Editor edits, saves, transfers tabs without restarting and protects dirty files', async () => {
    const fixture = GLib.dir_make_tmp('dev-os-editor-ui-XXXXXX');
    const path = `${fixture}/example.ts`; GLib.file_set_contents(path, 'const answer: number = 42;\n');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${fixture}/packages`, preferences: `${fixture}/preferences`});
    const context: UIContext = {application, display, preferences, config: () => DEFAULTS, saveCore() {},
        monitors: () => [display.get_monitor(0)!], runCommand: () => true, reload: () => true, quit() {}, invoke() {},
        registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {}};
    const assets = EditorAssets.create(), opened = new Set<EditorWindow>();
    const editor = new EditorWindow(context, assets, window => opened.delete(window), {opened: window => opened.add(window)});
    const waitFor = async (condition: () => boolean) => {
        for (let attempt = 0; attempt < 180; attempt++) {
            if (condition()) return;
            if (editor.surface?.error) throw new Error(editor.surface.error);
            await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        }
        throw new Error('Monaco editor did not become ready');
    };
    try {
        editor.show(); assert(await editor.openFile(path), 'Editor opens local files');
        await waitFor(() => editor.surface?.ready === true);
        const surface = editor.surface!, document = editor.document!;
        assert(await surface.evaluate('window.devOsEditor.getValue()') === document.content, 'Monaco receives the file contents');
        const browserReady = async (condition: string) => {
            for (let attempt = 0; attempt < 60; attempt++) {
                if (await surface.evaluate(`String(${condition})`) === 'true') return;
                await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => { resolve(); return GLib.SOURCE_REMOVE; }));
            }
            throw new Error(`Monaco UI did not become ready: ${condition}`);
        };
        await surface.evaluate('window.devOsEditor.find()');
        await browserReady('!!document.querySelector(".find-widget.visible")');
        await surface.evaluate('window.devOsEditor.find(true)');
        await browserReady('getComputedStyle(document.querySelector(".find-widget .replace-part")).display !== "none"');
        await surface.evaluate('document.querySelector(".find-widget .button.codicon-widget-close")?.click()');
        await surface.evaluate('window.devOsEditor.replace("const answer: number = \\"wrong\\";\\n")');
        await waitFor(() => document.dirty);
        assert(editor.window.get_title()?.endsWith(' *'), 'Dirty marker reaches the native header');
        for (let attempt = 0; attempt < 60; attempt++) {
            if (JSON.parse(await surface.evaluate('JSON.stringify(window.devOsEditor.diagnostics())')).length) break;
            await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => { resolve(); return GLib.SOURCE_REMOVE; }));
        }
        assert(JSON.parse(await surface.evaluate('JSON.stringify(window.devOsEditor.diagnostics())')).length > 0, 'Bundled TypeScript worker reports a real type error');
        editor.addTab(); const otherId = editor.activeTabId; editor.cycleTab(-1);
        editor.detachTab(editor.activeTabId);
        const detached = [...opened].find(window => window !== editor)!;
        assert(detached.document === document && detached.surface === surface, 'Detach retains the exact document and WebKit/Monaco instance');
        detached.moveTab(detached.activeTabId, editor, otherId);
        assert(opened.size === 1 && editor.surface === surface, 'Merge keeps the editor model and closes the empty source');
        await surface.evaluate('window.devOsEditor.undo()');
        assert(await surface.evaluate('window.devOsEditor.getValue()') === 'const answer: number = 42;\n', 'Undo history survives detach and merge');
        await surface.evaluate('window.devOsEditor.replace("const answer: number = \\"wrong\\";\\n")');
        assert(await editor.saveTab(), `Save native document: ${document.error}`);
        assert(new TextDecoder().decode(GLib.file_get_contents(path)[1]).includes('"wrong"') && !document.dirty, 'Save writes the live Monaco value');
        await surface.evaluate('window.devOsEditor.setValue("unsaved changes")'); await waitFor(() => document.dirty);
        const closing = editor.closeTab(editor.activeTabId);
        await waitFor(() => Gtk.Window.list_toplevels().some(window => window instanceof Gtk.MessageDialog));
        const confirmation = Gtk.Window.list_toplevels().find(window => window instanceof Gtk.MessageDialog);
        if (!(confirmation instanceof Gtk.MessageDialog)) throw new Error('Close confirmation is missing');
        confirmation.response(Gtk.ResponseType.CANCEL);
        assert(!await closing && editor.document === document && document.dirty, 'Cancel closing preserves unsaved work');
    } finally {
        for (const window of [...opened]) window.destroy();
        (await assets).dispose(); preferences.dispose(); removeFixture(Gio.File.new_for_path(fixture));
    }
});
print(`${passed} React desktop UI tests passed`);
