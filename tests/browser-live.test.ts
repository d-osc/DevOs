import {Gtk, Gio, Gdk, GLib, setActiveTheme, type UIContext} from '@dev-os/core';
import Cairo from 'cairo';
import {testTheme} from './theme-helper.js';
import {DEFAULTS, ROOT} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {BrowserWindow} from '../extensions/org.devos.browser/window.js';
import {browserContextMenu, startContextMenu} from '../extensions/org.devos.browser/context-menu.js';
import {WebKit2, webKitSoftwareRendering} from '@dev-os/core/webkit';

Gtk.init(null);
const icons = Gtk.IconTheme.get_default();
icons.prepend_search_path(`${ROOT}/data/icons`);
for (const icon of ['dev-os-browser', 'dev-os-browser-symbolic']) {
    if (!icons.load_icon(icon, 48, Gtk.IconLookupFlags.FORCE_SIZE)) throw new Error(`Missing Browser icon: ${icon}`);
}
setActiveTheme(GLib.getenv('DEV_OS_TEST_THEME') === 'light' ? 'light' : 'dark');
Gtk.Settings.get_default()!.gtk_application_prefer_dark_theme = GLib.getenv('DEV_OS_TEST_THEME') !== 'light';
const style = new Gtk.CssProvider();
style.load_from_data(new TextEncoder().encode(testTheme() + new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1])));
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, style, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
const application = new Gtk.Application({application_id: 'org.devos.BrowserLiveTest', flags: Gio.ApplicationFlags.NON_UNIQUE});
application.register(null);
const loop = new GLib.MainLoop(null, false);
let failed: unknown;
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function until(check: () => boolean, label: string) {
    for (let i = 0; i < 400; i++) {if (check()) return; await wait();}
    throw new Error(`Timed out: ${label}`);
}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
async function run() {
    const temporary = GLib.dir_make_tmp('devos-browser-test-XXXXXX');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const display = Gdk.Display.get_default()!;
    const context: UIContext = {application, display, preferences, config: () => DEFAULTS, saveCore() {},
        monitors: () => [display.get_monitor(0)!], runCommand: () => true, reload: () => true, quit() {}, invoke() {},
        registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {}};
    let closed = false;
    const browser = new BrowserWindow(context, () => {closed = true;});
    const all = () => widgets(browser.window);
    const views = () => all().filter(widget => widget instanceof WebKit2.WebView) as InstanceType<typeof WebKit2.WebView>[];
    const button = (tooltip: string) => all().find(widget => widget instanceof Gtk.Button && widget.get_tooltip_text() === tooltip) as Gtk.Button;
    const click = (name: string) => {const widget = all().find(widget => widget.name === name) as Gtk.Button; if (!widget) throw new Error(`Missing ${name}`); widget.clicked();};
    try {
        await until(() => browser.window.get_allocated_width() > 500, 'window layout');
        for (let i = 0; i < 8; i++) await wait();
        const screenshot = GLib.getenv('DEV_OS_BROWSER_SCREENSHOT');
        if (screenshot) {
            const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, browser.window.get_allocated_width(), browser.window.get_allocated_height());
            const cr = new Cairo.Context(surface); browser.window.draw(cr); surface.writeToPNG(screenshot); cr.$dispose();
            print(`PASS: Start page screenshot ${screenshot}`);
        }
        const view = views()[0]!;
        if (webKitSoftwareRendering && view.get_settings().get_hardware_acceleration_policy() !== WebKit2.HardwareAccelerationPolicy.NEVER)
            throw new Error('WSL Browser must use software rendering');
        const startSearch = all().find(widget => widget instanceof Gtk.Entry && widget.get_style_context().has_class('browser-start-search')) as Gtk.Entry;
        if (!startSearch) throw new Error('Start page search missing');
        startSearch.set_text('example.com'); startSearch.emit('activate');
        await until(() => !view.is_loading && view.get_title() === 'Example Domain', 'load external HTTPS page');
        print('PASS: Browser opens and loads real HTTPS content');
        const menu = new WebKit2.ContextMenu();
        const nativeCopy = WebKit2.ContextMenuItem.new_from_stock_action(WebKit2.ContextMenuAction.COPY);
        menu.append(nativeCopy);
        let opened: string | undefined;
        browserContextMenu(menu, view, new WebKit2.HitTestResult({context: WebKit2.HitTestResultContext.LINK, link_uri: 'https://example.com/link'}), uri => {opened = uri;});
        const action = (name: string) => menu.get_items().find(item => !item.is_separator() && item.get_gaction()?.get_name() === name)?.get_gaction();
        if (!menu.get_items().includes(nativeCopy)) throw new Error('Context menu discarded native Copy');
        action('open-link-tab')?.activate(null);
        if (opened !== 'https://example.com/link') throw new Error('Context menu did not open link in tab');
        if (!action('reload') || !action('copy-page-address')) throw new Error('Page context actions missing');
        if (!action('back') || !action('forward')) throw new Error('Context navigation missing');
        if (!view.get_settings().get_enable_developer_extras() || !menu.get_items().some(item => item.get_stock_action() === WebKit2.ContextMenuAction.INSPECT_ELEMENT))
            throw new Error('Inspect action or developer tools missing');
        const startMenu = startContextMenu(() => {opened = 'new';}, () => {}, {back() {}, forward() {}, reload() {}, canBack: false, canForward: false});
        const startRows = startMenu.get_children() as Gtk.MenuItem[];
        for (const label of ['Back', 'Forward', 'Reload', 'Inspect'])
            if (!startRows.some(item => item.get_label() === label)) throw new Error(`Start menu missing ${label}`);
        startRows.find(item => item.get_label() === 'New tab')!.activate(); startMenu.destroy();
        if (String(opened) !== 'new') throw new Error('Start page New tab action failed');
        print('PASS: Context menu link, navigation, native Copy and start page actions');
        const inspector = view.get_inspector(); inspector.show();
        await until(() => !!inspector.get_web_view()?.get_parent(), 'inspector frontend');
        inspector.attach();
        await until(() => inspector.is_attached() && inspector.get_web_view().get_mapped(), 'docked developer tools');
        inspector.detach();
        await until(() => inspector.get_web_view()?.get_toplevel() instanceof Gtk.ApplicationWindow && inspector.get_web_view().get_toplevel().name === 'browser-devtools', 'detached developer tools');
        for (let i = 0; i < 30; i++) await wait();
        const inspectorShot = GLib.getenv('DEV_OS_BROWSER_INSPECTOR_SCREENSHOT');
        if (inspectorShot) Gio.Subprocess.new(['grim', inspectorShot], Gio.SubprocessFlags.NONE).wait_check(null);
        const dockButton = widgets(inspector.get_web_view().get_toplevel()).find(widget => widget instanceof Gtk.Button && widget.get_label() === 'Dock below') as Gtk.Button;
        if (!dockButton?.sensitive) throw new Error('Dock below button is not available');
        dockButton.clicked(); await until(() => inspector.is_attached(), 'reattach developer tools');
        inspector.close(); await wait();
        inspector.show(); await until(() => !!inspector.get_web_view()?.get_parent(), 'reopen developer tools');
        inspector.close(); await wait();
        print('PASS: Themed inspector docks, undocks, closes and reopens');
        const address = all().find(widget => widget instanceof Gtk.Entry) as Gtk.Entry;
        for (const [file, title] of [['one.html', 'First page'], ['two.html', 'Second page']]) GLib.file_set_contents(`${temporary}/${file}`, `<html><head><title>${title}</title></head><body>${title}</body></html>`);
        const one = Gio.File.new_for_path(`${temporary}/one.html`).get_uri(), two = Gio.File.new_for_path(`${temporary}/two.html`).get_uri();
        view.load_uri(one); await until(() => !view.is_loading && view.get_title() === 'First page', 'first fixture');
        view.load_uri(two); await until(() => !view.is_loading && view.get_title() === 'Second page', 'second fixture');
        button('Back').clicked(); await until(() => !view.is_loading && view.get_title() === 'First page', 'back');
        button('Forward').clicked(); await until(() => !view.is_loading && view.get_title() === 'Second page', 'forward');
        button('Reload / Stop').clicked(); await until(() => !view.is_loading && view.get_title() === 'Second page', 'reload');
        print('PASS: Back, Forward and Reload');
        const add = all().find(widget => widget instanceof Gtk.Button && (widget.get_tooltip_text() || '').includes('New tab')) as Gtk.Button;
        if (!add) throw new Error('New tab button missing'); add.clicked();
        await until(() => views().length === 2, 'add tab');
        click('window-tab-1');
        if (!browser.window.get_title()?.includes('Second page')) throw new Error('Tab switch lost page');
        if (address.get_text() !== two) throw new Error('Address does not follow selected tab');
        print('PASS: Add and switch tabs, address follows active tab');
        click('window-tab-close-2');
        await until(() => views().length === 1, 'close background tab');
        address.set_text('https://example.com/'); address.emit('activate');
        await until(() => !view.is_loading && view.get_title() === 'Example Domain', 'address navigation');
        print('PASS: Close background tab and navigate using address bar');
        button('Start page').clicked();
        if (!browser.window.get_title()?.includes('New tab') || address.get_text() !== '') throw new Error('Start page did not reset title and address');
        print('PASS: Start page search and Home navigation');
        print(`PASS: Window rendered at ${browser.window.get_allocated_width()} × ${browser.window.get_allocated_height()}`);
        click('window-tab-close-1');
        if (!closed) throw new Error('Closing last tab did not close window');
        print('PASS: Closing last tab closes window');
    } finally {if (!closed) browser.window.destroy(); preferences.dispose();}
    if (!closed) throw new Error('Window close callback did not run');
    print('PASS: Browser window cleanup');
}
const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 90, () => {failed = new Error('Browser test timeout'); loop.quit(); return GLib.SOURCE_REMOVE;});
void run().catch(error => {failed = error;}).finally(() => loop.quit());
loop.run(); GLib.source_remove(timeout);
if (failed) throw failed;
