import {testTheme} from './theme-helper.js';
import {Gtk, Gdk, Gio, GLib, React, createRoot, removeTree, type UIContext, type UICommand} from '@dev-os/core';
import {ExtensionManager} from '@dev-os/extensions';
import {ROOT} from '@dev-os/config';
import {AppStoreView} from '../src/apps/org.devos.appstore/view.js';
import {storeAppIcon} from '../src/apps/org.devos.appstore/app-icon.js';
import {registryApps} from '../src/apps/org.devos.appstore/registry.js';
import storeExtension from '../src/apps/org.devos.appstore/extension.js';
import {PackageManagerCli} from '../src/apps/org.devos.appstore/package-backend.js';
import {RegistryManager} from '../src/apps/org.devos.appstore/registry-backend.js';
import {AppStoreSettings} from '../src/apps/org.devos.appstore/settings.js';
import {AppStore, type StoreControls, type StoreState, type Action} from '../src/apps/org.devos.appstore/backend.js';
Gtk.init(null);
const loop = new GLib.MainLoop(null, false);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT,100,()=>{resolve();return GLib.SOURCE_REMOVE;}));
const widgets = (widget: Gtk.Widget): Gtk.Widget[] => [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];
async function test() {
    for (const app of registryApps()) {
        const icon = Gtk.IconTheme.get_default().lookup_by_gicon(storeAppIcon(app), 40, Gtk.IconLookupFlags.FORCE_SIZE);
        if (!icon?.load_icon()) throw new Error(`Store card icon cannot render: ${app.id}`);
    }
    const real = await new AppStore().request('get'); if (!Array.isArray(real.catalog) || !Array.isArray(real.installed)) throw new Error('Real backend bridge failed');
    const state: StoreState = {available:true,connected:true,installed:[],catalog:[{id:"org.devos.Example",package:"devos-example",name:"Example",description:"Native test app",category:"Creative"}]};
    const actions: Action[]=[];
    const controls: StoreControls = {busy:false, async request(action,id) {
        actions.push(action); const app = state.catalog.find(item=>item.id===id);
        if(action==='install') {if(!app)throw new Error('Unknown app');state.installed=[{...app,version:'1.0'}];}
        if(action==='remove')state.installed=[];
        if(action==='updates')return {...state,updates:[{...state.catalog[0],version:'2.0'}]};
        return {...state};
    }};
    const window=new Gtk.OffscreenWindow();window.name='app-store';window.set_size_request(1100,760);const root=createRoot(window);
    const css=new Gtk.CssProvider();css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!,css,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find=(id:string)=>widgets(window).find(widget=>widget.name===id) as Gtk.Button;
    const click=async(id:string)=>{const widget=find(id);if(!widget)throw new Error(`Missing ${id}`);widget.clicked();await wait();};
    try {
        root.render(<AppStoreView controls={controls}/>);window.show_all();await wait();await wait();
        const screenshot=GLib.getenv('DEV_OS_STORE_SCREENSHOT');if(screenshot)window.get_pixbuf()!.savev(screenshot,'png',[],[]);
        const id=state.catalog[0].id;
        await click(`app-store-app-${id}`);await click('app-store-install');
        if(actions.includes('install'))throw new Error('Install requires confirmation');
        await click('app-store-confirm');if(!find('app-store-open'))throw new Error('Installed state not reflected');
        await click('app-store-remove');await click('app-store-cancel');if(actions.includes('remove'))throw new Error('Cancel must preserve app');
        await click('app-store-remove');await click('app-store-confirm');if(!find('app-store-install'))throw new Error('Removal not reflected');
        await click('app-store-back');(find('app-store-search') as unknown as Gtk.SearchEntry).set_text('no-match-app-123');await wait();
        if(find(`app-store-app-${id}`))throw new Error('Search filter failed');
        (find('app-store-search') as unknown as Gtk.SearchEntry).set_text('');await wait();await click('app-store-tab-updates');await click('app-store-check-updates');
        if(!find(`app-store-app-${id}`))throw new Error('Updates not rendered');
        root.render(<AppStoreView key="native-preview" controls={{busy:false,async request(){return real;}}}/>);await wait();await wait();
        window.queue_draw(); await wait();
        const emptyScreenshot=GLib.getenv('DEV_OS_STORE_EMPTY_SCREENSHOT');if(emptyScreenshot)window.get_pixbuf()!.savev(emptyScreenshot,'png',[],[]);
        const scroll = find('app-store-scroll') as unknown as Gtk.ScrolledWindow;
        scroll.get_vadjustment().set_value(100);
        await click('app-store-app-registry:vscode');
        if (scroll.get_vadjustment().get_value() !== 0) throw new Error('App details must open at the top instead of inheriting the catalog scroll position');
        if (find('app-store-install') || !find('app-store-user-install') || !find('app-store-readme')) throw new Error('Registry apps must use DevOsPM actions and show metadata');
        await click('app-store-back');
        const iconsScreenshot=GLib.getenv('DEV_OS_STORE_ICONS_SCREENSHOT');
        await click('app-store-tab-developer tools');
        for (const id of ['vscode', 'zcode']) {
            const card = find(`app-store-app-registry:${id}`);
            if (!card || card.get_allocated_height() > 280) throw new Error('A small collection must not stretch app cards to the viewport height');
        }
        if (iconsScreenshot) window.get_pixbuf()!.savev(iconsScreenshot,'png',[],[]);
        await click('app-store-tab-discover');
        const detailScreenshot = GLib.getenv('DEV_OS_STORE_DETAIL_SCREENSHOT');
        if (detailScreenshot) {
            const packages = new PackageManagerCli();
            root.render(<AppStoreView key="detail-preview" controls={{busy:false, async request(){return real;}}} packages={packages} registry={new RegistryManager(packages)}/>);
            await wait(); await wait(); await click('app-store-app-registry:chatgpt'); await wait();
            window.get_pixbuf()!.savev(detailScreenshot, 'png', [], []);
        }
        window.name='settings'; let opened=0;
        root.render(<AppStoreSettings controls={{busy:false,async request(){return {...real,available:false,connected:false};}}} openStore={()=>opened++}/>);await wait();await wait();
        if(find('app-store-settings-updates').sensitive)throw new Error('Unconfigured store must disable update checking');
        await click('app-store-settings-open');if(opened!==1)throw new Error('Settings must open the actual App Store');
        await click('app-store-settings-refresh');if(!find('app-store-settings-status'))throw new Error('Settings status missing');
        const settingsScreenshot=GLib.getenv('DEV_OS_STORE_SETTINGS_SCREENSHOT');if(settingsScreenshot)window.get_pixbuf()!.savev(settingsScreenshot,'png',[],[]);
        root.render(<AppStoreSettings key="ready" controls={controls} openStore={()=>opened++}/>);await wait();await wait();
        if(!find('app-store-settings-updates').sensitive)throw new Error('Configured native store must support update checking');
        await click('app-store-settings-updates');if(actions[actions.length-1]!=='updates')throw new Error('Settings update action not connected');
    } finally {root.unmount();window.destroy();Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!,css);}
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!,css,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const application = new Gtk.Application({application_id: 'org.devos.AppStoreStartupTest', flags: Gio.ApplicationFlags.NON_UNIQUE});
    application.register(null);
    const commands = new Map<string, UICommand>();
    const extensionsRoot = GLib.dir_make_tmp('devos-appstore-extensions-XXXXXX');
    const preferences = new ExtensionManager({system: `${ROOT}/src/apps`, components: `${ROOT}/src/system`, bundled: `${ROOT}/src/extensions`, user: `${extensionsRoot}/packages`, preferences: `${extensionsRoot}/preferences`});
    const context = {application, preferences, invoke() {}, registerCommand(name: string, handler: UICommand) {commands.set(name, handler); return () => commands.delete(name);}} as unknown as UIContext;
    const stop = storeExtension.activate(context);
    try {
        commands.get('app-store')!(); await wait(); await wait();
        const store = application.get_windows().find(item => item.name === 'app-store');
        if (!store?.get_visible()) throw new Error('Real AppStore extension must open its window with file-drop registration');
        if (!widgets(store).some(widget => widget.name === 'app-store-tab-extensions')) throw new Error('Extensions must be part of App Store navigation');
        // The initial real inventory request can still be busy after window creation.
        for (let attempt = 0; attempt < 50 && !widgets(store).some(widget => widget.name === 'store-registry-extensions'); attempt++) {
            commands.get('app-store-extensions')!(); await wait();
        }
        if (!widgets(store).some(widget => widget.name === 'store-registry-extensions')) throw new Error('Extension deep links must open the registry extension catalog');
        if (widgets(store).some(widget => widget.name === 'store-connect')) throw new Error('Extensions must read the central catalog instead of requiring repository input');
        if (!widgets(store).some(widget => widget.name === 'store-registry-org.example.workspace-notes')) throw new Error('The registry example must appear in Extensions');
        const previewDirectory = GLib.getenv('DEV_OS_STORE_SCREENSHOTS');
        const snapshot = (name: string) => {
            if (!previewDirectory) return;
            GLib.mkdir_with_parents(previewDirectory, 0o755);
            const image = Gdk.pixbuf_get_from_window(store.get_window()!, 0, 0, store.get_allocated_width(), store.get_allocated_height());
            image?.savev(`${previewDirectory}/${name}.png`, 'png', [], []);
        };
        snapshot('extensions-catalog');
        (widgets(store).find(widget => widget.name === 'store-registry-org.example.workspace-notes') as Gtk.Button).clicked(); await wait(); await wait();
        if (!widgets(store).some(widget => widget.name === 'store-extension-detail')) throw new Error('Extension cards must open a detail page');
        const availability = widgets(store).find(widget => widget.name === 'store-catalog-check-org.example.workspace-notes');
        if (!availability || availability.get_sensitive()) throw new Error('Unpublished extension must remain unavailable');
        snapshot('extension-detail');
        (widgets(store).find(widget => widget.name === 'store-extension-back') as Gtk.Button).clicked(); await wait();
        if (!widgets(store).some(widget => widget.name === 'store-registry-extensions')) throw new Error('Back must restore the extension catalog');
        if (preferences.list().some(item => item.manifest.id === 'org.devos.store')) throw new Error('The standalone Extension Store must be retired from Settings');
        commands.get('settings.store')!(); await wait();
        if (application.get_windows().filter(item => item.name === 'app-store').length !== 1) throw new Error('Legacy store links must reuse the existing App Store window');
        commands.get('package-install')!(undefined, '/tmp/devos-missing-startup-fixture.dpk'); await wait();
        if (!application.get_windows().some(item => item.name === 'package-install' && item.get_visible())) throw new Error('Real package install window must open with file-drop registration');
    } finally {stop(); application.quit(); preferences.dispose(); removeTree(extensionsRoot);Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!,css);}
    print('PASS: native inventory bridge, browsing, search, install confirmation, remove cancellation, updates and real extension window startup');
}
let failure:unknown;void test().catch(error=>{failure=error;}).finally(()=>loop.quit());loop.run();if(failure)throw failure;
