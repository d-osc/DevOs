import {Gtk, Gdk, type UIContext} from '@dev-os/core';
import {mountTabbedHeader} from '@dev-os/services/window-tabs';
import {WebKit2 as WebKit, webKitSoftwareRendering} from '@dev-os/core/webkit';
import {BrowserData} from './data.js';
import {browserContextMenu, startContextMenu} from './context-menu.js';
import {BrowserInspector} from './inspector.js';
import {BrowserDownloads} from './downloads.js';

export class BrowserWindow {
    readonly window: Gtk.ApplicationWindow;
    private body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    private stack = new Gtk.Stack({hexpand: true, vexpand: true});
    private address = new Gtk.Entry({hexpand: true, placeholder_text: 'Search or enter a web address'});
    private status = new Gtk.Label({xalign: 0, ellipsize: 3, no_show_all: true});
    private back = this.iconButton('go-previous-symbolic', 'Back');
    private forward = this.iconButton('go-next-symbolic', 'Forward');
    private reload = this.iconButton('view-refresh-symbolic', 'Reload / Stop');
    private progress = new Gtk.ProgressBar({no_show_all: true});
    private tabs: {id: number; view: InstanceType<typeof WebKit.WebView>; page: Gtk.Stack; home: boolean; inspector: BrowserInspector}[] = [];
    private active = 0;
    private data = new BrowserData();
    private nextId = 1;
    private header: ReturnType<typeof mountTabbedHeader>;
    private tabSignature = '';
    private webContext = new WebKit.WebContext();
    private downloads: BrowserDownloads;
    constructor(context: UIContext, closed: () => void) {
        this.window = new Gtk.ApplicationWindow({application: context.application, title: 'Browser', default_width: 1120, default_height: 760});
        this.window.name = 'browser'; this.window.add(this.body);
        this.downloads = new BrowserDownloads(this.window, this.webContext);
        this.header = mountTabbedHeader(this.window, {title: 'Browser', iconName: 'dev-os-browser-symbolic', windowIconName: 'dev-os-browser'});
        const toolbar = new Gtk.Box({spacing: 6}); toolbar.get_style_context().add_class('browser-toolbar');
        const home = this.iconButton('go-home-symbolic', 'Start page');
        this.address.name = 'browser-address';
        this.address.set_icon_from_icon_name(Gtk.EntryIconPosition.PRIMARY, 'edit-find-symbolic');
        this.address.set_icon_activatable(Gtk.EntryIconPosition.PRIMARY, false);
        for (const widget of [this.back, this.forward, this.reload, home, this.address]) toolbar.add(widget);
        const hint = new Gtk.Label({label: 'Ctrl + L'}); hint.get_style_context().add_class('browser-shortcut'); toolbar.add(hint);
        toolbar.add(this.downloads.button);
        this.progress.get_style_context().add_class('browser-progress');
        this.status.get_style_context().add_class('browser-status');
        this.body.add(toolbar); this.body.add(this.progress); this.body.pack_start(this.stack, true, true, 0); this.body.add(this.status);
        this.body.add(this.downloads.widget);
        home.connect('clicked', () => {
            const tab = this.tabs.find(tab => tab.id === this.active); if (!tab) return;
            tab.view.stop_loading(); tab.home = true; tab.page.set_visible_child_name('home'); this.select(tab.id);
        });
        this.back.connect('clicked', () => this.current?.go_back());
        this.forward.connect('clicked', () => this.current?.go_forward());
        this.reload.connect('clicked', () => { const view = this.current; if (view?.is_loading) view.stop_loading(); else view?.reload(); });
        this.address.connect('activate', () => {const view = this.current; void this.data.navigate(this.address.get_text()).then(uri => {if (view && this.tabs.some(tab => tab.view === view)) {view.load_uri(uri); view.grab_focus();}}).catch(error => this.status.label = String(error));});
        this.window.connect('key-press-event', (_window, event) => {
            const native = event as unknown as Gdk.Event, key = native.get_keyval()[1], ctrl = native.get_state()[1] & Gdk.ModifierType.CONTROL_MASK;
            if (ctrl && [Gdk.KEY_l, Gdk.KEY_L].includes(key)) {this.address.grab_focus(); this.address.select_region(0, -1); return true;}
            if (ctrl && [Gdk.KEY_t, Gdk.KEY_T].includes(key)) {this.add(); return true;}
            if (ctrl && [Gdk.KEY_w, Gdk.KEY_W].includes(key)) {this.close(this.active); return true;}
            if (key === Gdk.KEY_F5 || ctrl && [Gdk.KEY_r, Gdk.KEY_R].includes(key)) {this.current?.reload(); return true;}
            return false;
        });
        this.window.connect('destroy', () => {this.downloads.dispose(); this.data.destroy(); this.tabs.forEach(tab => {tab.inspector.dispose(); tab.view.stop_loading();}); this.tabs = []; this.header.destroy(); closed();});
        this.add(); this.window.show_all(); this.window.present();
    }
    private iconButton(icon: string, tooltip: string) {
        const button = new Gtk.Button({tooltip_text: tooltip, can_focus: true});
        button.add(Gtk.Image.new_from_icon_name(icon, Gtk.IconSize.MENU)); return button;
    }
    private startPage(navigate: (uri: string) => void) {
        const page = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true, vexpand: true});
        page.get_style_context().add_class('browser-start');
        const center = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18, halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER, vexpand: true, margin: 32});
        const emblem = Gtk.Image.new_from_icon_name('dev-os-browser-symbolic', Gtk.IconSize.DIALOG);
        emblem.pixel_size = 40; emblem.halign = Gtk.Align.CENTER; emblem.get_style_context().add_class('browser-emblem'); center.add(emblem);
        const eyebrow = new Gtk.Label({label: 'DEV OS  /  BROWSER'}); eyebrow.get_style_context().add_class('browser-eyebrow'); center.add(eyebrow);
        const title = new Gtk.Label({label: 'A little curiosity goes a long way.'}); title.get_style_context().add_class('browser-heading'); center.add(title);
        const subtitle = new Gtk.Label({label: 'Find an answer. Start a project. Discover something new.'}); subtitle.get_style_context().add_class('browser-description'); center.add(subtitle);
        const search = new Gtk.Entry({placeholder_text: 'Search the web or enter a URL', width_chars: 48, margin_top: 12});
        search.get_style_context().add_class('browser-start-search'); search.set_icon_from_icon_name(Gtk.EntryIconPosition.PRIMARY, 'edit-find-symbolic');
        search.connect('activate', () => {void this.data.navigate(search.get_text()).then(navigate).catch(error => this.status.label = String(error));}); center.add(search);
        const links = new Gtk.Box({spacing: 12, halign: Gtk.Align.CENTER, margin_top: 12});
        for (const [name, caption, icon, uri] of [
            ['GitHub', 'Build together', 'utilities-terminal-symbolic', 'https://github.com/'],
            ['MDN', 'Learn the web', 'help-browser-symbolic', 'https://developer.mozilla.org/'],
            ['Wikipedia', 'Follow a question', 'accessories-dictionary-symbolic', 'https://www.wikipedia.org/'],
        ]) {
            const button = new Gtk.Button({tooltip_text: uri}); button.get_style_context().add_class('browser-quicklink');
            const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
            const image = Gtk.Image.new_from_icon_name(icon!, Gtk.IconSize.LARGE_TOOLBAR); content.add(image);
            const label = new Gtk.Label({label: name}); label.get_style_context().add_class('browser-link-title'); content.add(label);
            const detail = new Gtk.Label({label: caption}); detail.get_style_context().add_class('browser-description'); content.add(detail);
            button.add(content); button.connect('clicked', () => navigate(uri!)); links.add(button);
        }
        center.add(links); page.pack_start(center, true, true, 0);
        const footer = new Gtk.Label({label: 'Search with DuckDuckGo     ·     Ctrl + T  New tab     ·     Ctrl + L  Address bar', margin_bottom: 24});
        footer.get_style_context().add_class('browser-footer'); page.add(footer);
        const host = new Gtk.EventBox(); host.add(page);
        host.connect('button-press-event', (_widget, event) => {
            if ((event as unknown as Gdk.Event).get_button()[1] !== 3) return false;
            const menu = startContextMenu(() => this.add(), () => {this.address.grab_focus(); this.address.select_region(0, -1);}, {
                back: () => this.current?.go_back(), forward: () => this.current?.go_forward(), reload: () => host.queue_draw(),
                canBack: this.current?.can_go_back() ?? false, canForward: this.current?.can_go_forward() ?? false,
            });
            menu.attach_to_widget(host, null); menu.connect('selection-done', () => menu.destroy());
            menu.show_all(); menu.popup_at_pointer(event as unknown as Gdk.Event); return true;
        });
        return host;
    }
    private get current() {return this.tabs.find(tab => tab.id === this.active)?.view;}
    private updateTabs() {
        const tabs = this.tabs.map(tab => ({id: tab.id, label: tab.home ? 'New tab' : tab.view.get_title() || 'Loading…', iconName: 'dev-os-browser-symbolic', widthChars: 9}));
        const signature = JSON.stringify([this.active, tabs]);
        if (signature === this.tabSignature) return;
        this.tabSignature = signature;
        this.header.update({tabs, active: this.active, select: id => this.select(id), close: id => this.close(id), add: () => this.add()});
    }
    private updateProgress() {
        const view = this.current;
        const home = this.tabs.find(tab => tab.id === this.active)?.home;
        this.progress.fraction = view?.estimated_load_progress || 0;
        this.progress.set_visible(!!view?.is_loading && !home);
    }
    private update(forceAddress = false) {
        const view = this.current;
        const home = this.tabs.find(tab => tab.id === this.active)?.home;
        this.updateTabs();
        this.back.sensitive = view?.can_go_back() ?? false; this.forward.sensitive = view?.can_go_forward() ?? false;
        if (forceAddress || !this.address.has_focus) this.address.set_text(home ? '' : view?.get_uri() || '');
        this.address.set_icon_from_icon_name(Gtk.EntryIconPosition.PRIMARY, home ? 'edit-find-symbolic' : view?.get_uri()?.startsWith('https://') ? 'channel-secure-symbolic' : 'dev-os-browser-symbolic');
        (this.reload.get_child() as Gtk.Image).set_from_icon_name(view?.is_loading ? 'process-stop-symbolic' : 'view-refresh-symbolic', Gtk.IconSize.MENU);
        this.updateProgress();
        this.window.set_title(`Browser · ${home ? 'New tab' : view?.get_title() || 'Loading…'}`);
    }
    private select(id: number) {this.active = id; this.stack.set_visible_child_name(String(id)); this.status.hide(); this.update(true);}
    private add(uri?: string) {
        const settings = new WebKit.Settings();
        settings.set_enable_developer_extras(true);
        if (webKitSoftwareRendering) settings.set_hardware_acceleration_policy(WebKit.HardwareAccelerationPolicy.NEVER);
        const id = this.nextId++, view = new WebKit.WebView({hexpand: true, vexpand: true, settings, web_context: this.webContext});
        view.connect('context-menu', (_view, menu, _event, hit) => browserContextMenu(menu, view, hit, uri => this.add(uri)));
        const page = new Gtk.Stack({hexpand: true, vexpand: true});
        const inspector = new BrowserInspector(view, this.window);
        const tab = {id, view, page, home: !uri, inspector}; this.tabs.push(tab);
        page.add_named(this.startPage(uri => {view.load_uri(uri); view.grab_focus();}), 'home'); page.add_named(view, 'web');
        this.stack.add_named(page, String(id)); page.show_all(); page.set_visible_child_name(uri ? 'web' : 'home');
        view.connect('notify::estimated-load-progress', () => {if (id === this.active) this.updateProgress();});
        for (const property of ['title', 'uri', 'is-loading']) view.connect(`notify::${property}`, () => {if (id === this.active) this.update(); else if (property === 'title') this.updateTabs();});
        view.connect('load-changed', (_view, event) => {if (event === WebKit.LoadEvent.STARTED) {tab.home = false; page.set_visible_child_name('web');} if (id === this.active) {this.status.hide(); this.update();} else this.updateTabs();});
        view.connect('load-failed', (_view, _event, _uri, error) => {if (id === this.active) {this.status.set_text(error.message); this.status.show();} return false;});
        view.connect('web-process-terminated', () => {if (id === this.active) {this.status.set_text('Web process stopped. Reload to try again.'); this.status.show();}});
        view.connect('decide-policy', (_view, decision, type) => {
            if (type !== WebKit.PolicyDecisionType.NEW_WINDOW_ACTION) return false;
            const uri = (decision as import('@dev-os/core').WebKit2Types.NavigationPolicyDecision).get_request().get_uri();
            decision.ignore(); if (uri && /^https?:\/\//i.test(uri)) this.add(uri); return true;
        });
        this.select(id); if (uri) view.load_uri(uri);
    }
    private close(id: number) {
        const index = this.tabs.findIndex(tab => tab.id === id); if (index < 0) return;
        const [tab] = this.tabs.splice(index, 1); tab!.inspector.dispose(); tab!.view.stop_loading(); tab!.page.destroy();
        if (!this.tabs.length) {this.window.destroy(); return;}
        this.select(this.active === id ? this.tabs[Math.min(index, this.tabs.length - 1)]!.id : this.active);
    }
}
